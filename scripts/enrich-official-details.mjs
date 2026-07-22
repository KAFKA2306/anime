import { chromium } from 'playwright';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  OFFICIAL_GENRES,
  buildAttributeRecord,
  parseOfficialDetailText,
} from './lib/ontology.mjs';

const DATA_DIR = path.resolve('data');
const ATTRIBUTE_DIR = path.resolve('attributes', 'by-work');
const ONLY_YEAR = process.env.DANIME_ENRICH_YEAR ? Number(process.env.DANIME_ENRICH_YEAR) : null;
const LIMIT = Number(process.env.DANIME_ENRICH_LIMIT ?? (ONLY_YEAR ? 0 : 500));
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.DANIME_ENRICH_CONCURRENCY ?? 2)));
const RATE_LIMIT_MS = Math.max(300, Number(process.env.DANIME_ENRICH_RATE_LIMIT_MS ?? 900));
const REFRESH = process.env.DANIME_ENRICH_REFRESH === '1';
const FETCHED_AT = new Date().toISOString();
const OFFICIAL_ORIGIN = 'https://animestore.docomo.ne.jp';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizedDetailUrl(work) {
  try {
    const url = new URL(work.detail_url, OFFICIAL_ORIGIN);
    if (url.origin !== OFFICIAL_ORIGIN || !url.pathname.endsWith('/animestore/ci_pc')) return null;
    const workId = url.searchParams.get('workId');
    if (!workId || String(workId) !== String(work.work_id)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function listCandidates() {
  if (ONLY_YEAR) {
    const payload = await readJson(path.join(DATA_DIR, 'by-year', `${ONLY_YEAR}.json`));
    return payload.works;
  }
  return readJson(path.join(DATA_DIR, 'works.json'));
}

async function existingAttributeIds() {
  await mkdir(ATTRIBUTE_DIR, { recursive: true });
  const files = await readdir(ATTRIBUTE_DIR).catch(() => []);
  return new Set(files
    .filter((name) => /^[A-Za-z0-9_-]+\.json$/u.test(name))
    .map((name) => name.replace(/\.json$/u, '')));
}

async function extractFromPage(page, work, detailUrl) {
  const response = await page.goto(detailUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  if (!response || response.status() >= 400) {
    throw new Error(`HTTP ${response?.status() ?? 'no response'}`);
  }

  await page.waitForTimeout(500);
  const bodyText = await page.locator('body').innerText({ timeout: 15_000 });
  const anchorLabels = await page.locator('a').allTextContents();
  const parsed = parseOfficialDetailText(bodyText, anchorLabels);
  const record = buildAttributeRecord({
    workId: work.work_id,
    title: parsed.title || work.title,
    detailUrl,
    officialGenres: parsed.officialGenres,
    synopsis: parsed.synopsis,
    staffText: parsed.staffText,
    productionYear: parsed.productionYear,
    fetchedAt: FETCHED_AT,
  });

  if (!record.official_genres.length) {
    throw new Error('official genre metadata was not found');
  }
  if (record.official_genres.some((genre) => !OFFICIAL_GENRES.includes(genre))) {
    throw new Error('unknown official genre was extracted');
  }
  return record;
}

async function worker(context, queue, failures, stats) {
  const page = await context.newPage();
  try {
    while (queue.length) {
      const work = queue.shift();
      if (!work) break;
      const detailUrl = normalizedDetailUrl(work);
      if (!detailUrl) {
        failures.push({ work_id: work.work_id, title: work.title, error: 'invalid official detail URL' });
        continue;
      }

      try {
        const record = await extractFromPage(page, work, detailUrl);
        await writeJson(path.join(ATTRIBUTE_DIR, `${work.work_id}.json`), record);
        stats.completed += 1;
        console.log(`${stats.completed}/${stats.total}: ${work.work_id} ${work.title}`);
      } catch (error) {
        failures.push({
          work_id: work.work_id,
          title: work.title,
          source_url: detailUrl,
          error: error instanceof Error ? error.message : String(error),
        });
        console.warn(`Failed ${work.work_id}: ${error instanceof Error ? error.message : error}`);
      }
      await sleep(RATE_LIMIT_MS);
    }
  } finally {
    await page.close();
  }
}

async function main() {
  const candidates = await listCandidates();
  const existing = await existingAttributeIds();
  let pending = candidates.filter((work) => REFRESH || !existing.has(String(work.work_id)));
  if (LIMIT > 0) pending = pending.slice(0, LIMIT);

  if (!pending.length) {
    console.log('No missing attribute records.');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    userAgent: 'KAFKA2306-anime-attribute-enricher/1.0 (+https://github.com/KAFKA2306/anime; official public metadata only)',
    viewport: { width: 1280, height: 900 },
  });

  const queue = [...pending];
  const failures = [];
  const stats = { completed: 0, total: pending.length };
  try {
    await Promise.all(Array.from(
      { length: Math.min(CONCURRENCY, pending.length) },
      () => worker(context, queue, failures, stats),
    ));
  } finally {
    await browser.close();
  }

  await mkdir(path.resolve('diagnostics'), { recursive: true });
  await writeJson(path.resolve('diagnostics', 'attribute-enrichment.json'), {
    generated_at: FETCHED_AT,
    requested_year: ONLY_YEAR,
    requested_count: pending.length,
    completed_count: stats.completed,
    failed_count: failures.length,
    failures,
  });

  if (failures.length > Math.max(5, Math.ceil(pending.length * 0.05))) {
    throw new Error(`Attribute enrichment failed for ${failures.length}/${pending.length} works.`);
  }
  console.log(`Enriched ${stats.completed} works; ${failures.length} failures recorded.`);
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
