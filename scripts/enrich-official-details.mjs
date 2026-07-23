import { chromium } from 'playwright';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OFFICIAL_GENRES, buildAttributeRecord, parseOfficialDetailText } from './lib/ontology.mjs';

const DATA_DIR = path.resolve('data');
const ATTRIBUTE_DIR = path.resolve('attributes', 'by-work');
const ONLY_YEAR = process.env.DANIME_ENRICH_YEAR ? Number(process.env.DANIME_ENRICH_YEAR) : null;
const LIMIT = Number(process.env.DANIME_ENRICH_LIMIT ?? (ONLY_YEAR ? 0 : 500));
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.DANIME_ENRICH_CONCURRENCY ?? 2)));
const RATE_LIMIT_MS = Math.max(300, Number(process.env.DANIME_ENRICH_RATE_LIMIT_MS ?? 900));
const MAX_PASSES = Math.max(1, Math.min(3, Number(process.env.DANIME_ENRICH_MAX_PASSES ?? 2)));
const PAGE_ATTEMPTS = Math.max(1, Math.min(3, Number(process.env.DANIME_ENRICH_PAGE_ATTEMPTS ?? 2)));
const REFRESH = process.env.DANIME_ENRICH_REFRESH === '1';
const FETCHED_AT = new Date().toISOString();
const OFFICIAL_ORIGIN = 'https://animestore.docomo.ne.jp';
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizedDetailUrl(work) {
  try {
    const url = new URL(work.detail_url, OFFICIAL_ORIGIN);
    if (url.origin !== OFFICIAL_ORIGIN || !url.pathname.endsWith('/animestore/ci_pc')) return null;
    if (url.searchParams.get('workId') !== String(work.work_id)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function listCandidates() {
  if (ONLY_YEAR) {
    return (await readJson(path.join(DATA_DIR, 'by-year', `${ONLY_YEAR}.json`))).works;
  }
  return readJson(path.join(DATA_DIR, 'works.json'));
}

async function existingAttributeIds() {
  await mkdir(ATTRIBUTE_DIR, { recursive: true });
  const files = await readdir(ATTRIBUTE_DIR).catch(() => []);
  return new Set(files.filter((name) => /^[A-Za-z0-9_-]+\.json$/u.test(name))
    .map((name) => name.replace(/\.json$/u, '')));
}

async function visibleOfficialGenreLinks(page) {
  const labels = await page
    .locator('a[href*="/animestore/tag_pc?tagId="]:visible')
    .allTextContents()
    .catch(() => []);
  return [...new Set(labels
    .map((label) => label.normalize('NFKC').replace(/\s+/g, ' ').trim())
    .filter((label) => OFFICIAL_GENRES.includes(label)))];
}

async function extractFromPage(page, work, detailUrl) {
  let lastReason = 'official genre metadata was not found';

  for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt += 1) {
    try {
      const response = await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      if (!response || response.status() >= 400) {
        throw new Error(`HTTP ${response?.status() ?? 'no response'}`);
      }

      await page.waitForTimeout(750);
      const bodyText = await page.locator('body').innerText({ timeout: 15_000 });
      const parsed = parseOfficialDetailText(bodyText);
      const linkedGenres = parsed.officialGenres.length ? [] : await visibleOfficialGenreLinks(page);
      const officialGenres = parsed.officialGenres.length ? parsed.officialGenres : linkedGenres;
      const record = buildAttributeRecord({
        workId: work.work_id,
        title: parsed.title || work.title,
        detailUrl,
        officialGenres,
        synopsis: parsed.synopsis,
        staffText: parsed.staffText,
        productionYear: parsed.productionYear,
        fetchedAt: FETCHED_AT,
      });

      if (!record.official_genres.length) {
        const pageTitle = await page.title().catch(() => '');
        lastReason = `official genre metadata was not found; page_title=${JSON.stringify(pageTitle)}`;
        throw new Error(lastReason);
      }
      if (record.official_genres.some((genre) => !OFFICIAL_GENRES.includes(genre))) {
        throw new Error('unknown official genre was extracted');
      }
      return record;
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
      if (attempt < PAGE_ATTEMPTS) await sleep(1_000 * attempt);
    }
  }

  throw new Error(`${lastReason}; attempts=${PAGE_ATTEMPTS}`);
}

async function worker(context, queue, failures, stats, rateLimitMs) {
  let page = await context.newPage();
  let handledByWorker = 0;
  try {
    while (queue.length) {
      const work = queue.shift();
      if (!work) break;
      const detailUrl = normalizedDetailUrl(work);
      if (!detailUrl) {
        failures.push({ work, work_id: work.work_id, title: work.title, error: 'invalid official detail URL' });
        continue;
      }

      try {
        const record = await extractFromPage(page, work, detailUrl);
        await writeJson(path.join(ATTRIBUTE_DIR, `${work.work_id}.json`), record);
        stats.completed += 1;
        console.log(`${stats.completed}/${stats.total}: ${work.work_id} ${work.title}`);
      } catch (error) {
        failures.push({
          work,
          work_id: work.work_id,
          title: work.title,
          source_url: detailUrl,
          error: error instanceof Error ? error.message : String(error),
        });
        console.warn(`Failed ${work.work_id}: ${error instanceof Error ? error.message : error}`);
      }

      handledByWorker += 1;
      if (handledByWorker % 50 === 0 && queue.length) {
        await page.close();
        page = await context.newPage();
      }
      await sleep(rateLimitMs);
    }
  } finally {
    await page.close();
  }
}

async function createContext(browser) {
  return browser.newContext({
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 1280, height: 900 },
    userAgent: 'KAFKA2306-anime-attribute-enricher/1.2 (+https://github.com/KAFKA2306/anime; official public metadata only)',
  });
}

async function runPass(browser, works, stats, passNumber) {
  const context = await createContext(browser);
  const queue = [...works];
  const failures = [];
  const passConcurrency = passNumber === 1 ? CONCURRENCY : 1;
  const passRateLimit = RATE_LIMIT_MS * passNumber;
  try {
    await Promise.all(Array.from(
      { length: Math.min(passConcurrency, works.length) },
      () => worker(context, queue, failures, stats, passRateLimit),
    ));
  } finally {
    await context.close();
  }
  return failures;
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
  const stats = { completed: 0, total: pending.length };
  let remaining = pending;
  let finalFailures = [];
  try {
    for (let pass = 1; pass <= MAX_PASSES && remaining.length; pass += 1) {
      console.log(`Attribute enrichment pass ${pass}/${MAX_PASSES}: ${remaining.length} works.`);
      finalFailures = await runPass(browser, remaining, stats, pass);
      remaining = finalFailures.map((failure) => failure.work);
      if (remaining.length && pass < MAX_PASSES) await sleep(2_000 * pass);
    }
  } finally {
    await browser.close();
  }

  const serializableFailures = finalFailures.map(({ work: _work, ...failure }) => failure);
  await mkdir(path.resolve('diagnostics'), { recursive: true });
  await writeJson(path.resolve('diagnostics', 'attribute-enrichment.json'), {
    generated_at: FETCHED_AT,
    requested_year: ONLY_YEAR,
    requested_count: pending.length,
    completed_count: stats.completed,
    failed_count: serializableFailures.length,
    max_passes: MAX_PASSES,
    page_attempts: PAGE_ATTEMPTS,
    failures: serializableFailures,
  });

  if (!stats.completed) {
    throw new Error(`Attribute enrichment produced no records from ${pending.length} works.`);
  }
  console.log(`Enriched ${stats.completed} works; ${serializableFailures.length} unresolved failures recorded.`);
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
