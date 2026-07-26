import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const SITE = 'https://kafka2306.github.io/anime';
const OUTPUT = 'verification/ontology-v2-live.json';
const COMBINED_TAG = 'SF・ファンタジー';
const FILES = [
  'data/manifest.json',
  'data/by-year/2024.json',
  'data/by-year/2025.json',
];
const SAMPLE_TITLES = [
  'しかのこのこのここしたんたん',
  'ワンルーム、日当たり普通、天使つき。',
  '〈物語〉シリーズ オフ&モンスターシーズン',
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new Error(message); };

function verifyWork(work, year) {
  if (work.ontology_version !== '2.0.0') fail(`${year}/${work.work_id}: stale ontology version`);
  if (!Array.isArray(work.canonical_tags) || !work.canonical_tags.length) fail(`${year}/${work.work_id}: canonical tags missing`);
  const searchable = JSON.stringify({ canonical_tags: work.canonical_tags, ontology_facets: work.ontology_facets });
  if (searchable.includes(COMBINED_TAG)) fail(`${year}/${work.work_id}: deprecated combined tag remains`);
  if (!Array.isArray(work.speculative_genres) || work.speculative_genres.some((value) => !['SF', 'ファンタジー'].includes(value))) {
    fail(`${year}/${work.work_id}: invalid speculative leaf`);
  }
}

async function fetchPublicExact(path, expectedHash) {
  let last = null;
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    const url = `${SITE}/${path}?verify=${Date.now()}-${attempt}`;
    const response = await fetch(url, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
    const body = Buffer.from(await response.arrayBuffer());
    last = { status: response.status, sha256: sha256(body), expected_sha256: expectedHash, url };
    console.log(`${path} attempt ${attempt}: HTTP ${last.status} ${last.sha256}`);
    if (response.ok && last.sha256 === expectedHash) return { ...last, body };
    await sleep(3_000);
  }
  fail(`${path}: public hash did not converge to repository hash; last=${JSON.stringify(last)}`);
}

async function writeReport(report) {
  await mkdir('verification', { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  const report = {
    status: 'running',
    verified_at: new Date().toISOString(),
    site: `${SITE}/`,
    repository_head_sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    data_commit_sha: execFileSync('git', ['log', '-1', '--format=%H', '--', 'data/by-year/2025.json'], { encoding: 'utf8' }).trim(),
    catalogue: null,
    public_files: {},
    public_json_samples: [],
    browser_samples: [],
  };

  let browser = null;
  try {
    const local = {};
    for (const path of FILES) {
      const body = await readFile(path);
      local[path] = { body, hash: sha256(body), json: JSON.parse(body.toString('utf8')) };
    }

    const manifest = local['data/manifest.json'].json;
    if (manifest.attributes?.ontology_version !== '2.0.0') fail('manifest ontology version is stale');
    if (manifest.attributes?.coverage_ratio !== 1) fail('manifest coverage is not 100%');
    if (manifest.year_count !== 66 || manifest.canonical_work_count !== 7542 || manifest.membership_count !== 7544) {
      fail('manifest catalogue counts changed unexpectedly');
    }

    for (const year of [2024, 2025]) {
      const payload = local[`data/by-year/${year}.json`].json;
      if (payload.attribute_coverage?.ontology_version !== '2.0.0' || payload.attribute_coverage?.coverage_ratio !== 1) {
        fail(`${year}: attribute coverage is incomplete`);
      }
      for (const work of payload.works) verifyWork(work, year);
    }
    if (local['data/by-year/2025.json'].json.works.length !== 307) fail('2025 count is not 307');

    report.catalogue = {
      year_count: manifest.year_count,
      canonical_work_count: manifest.canonical_work_count,
      membership_count: manifest.membership_count,
      ontology_version: manifest.attributes.ontology_version,
      coverage_ratio: manifest.attributes.coverage_ratio,
      year_2024_count: local['data/by-year/2024.json'].json.works.length,
      year_2025_count: local['data/by-year/2025.json'].json.works.length,
      deprecated_combined_tag_count: 0,
    };

    const publicBodies = {};
    for (const path of FILES) {
      const result = await fetchPublicExact(path, local[path].hash);
      report.public_files[path] = {
        url: result.url,
        status: result.status,
        sha256: result.sha256,
        expected_sha256: result.expected_sha256,
        exact_match: true,
      };
      publicBodies[path] = result.body;
    }

    const public2024 = JSON.parse(publicBodies['data/by-year/2024.json'].toString('utf8'));
    const samples = SAMPLE_TITLES.map((title) => {
      const work = public2024.works.find((candidate) => candidate.title === title);
      if (!work) fail(`2024 sample missing from public JSON: ${title}`);
      verifyWork(work, 2024);
      return {
        work_id: work.work_id,
        title,
        primary_genre: work.primary_genre,
        speculative_genres: work.speculative_genres,
        canonical_tags: work.canonical_tags,
      };
    });
    report.public_json_samples = samples;

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'ja-JP' });
    await page.goto(`${SITE}/?year=2024&verify=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.locator('#loadingState').waitFor({ state: 'hidden', timeout: 90_000 });

    const preferenceToggle = page.locator('#preferenceToggle');
    if (await preferenceToggle.isChecked()) await preferenceToggle.uncheck();
    const searchInput = page.locator('#searchInput');

    for (const sample of samples) {
      await searchInput.fill(sample.title);
      await page.waitForFunction((title) => {
        const cards = [...document.querySelectorAll('#workGrid .work-card')];
        const card = cards.find((candidate) => candidate.querySelector('.work-card__title')?.textContent?.trim() === title);
        return Boolean(card?.querySelector('.work-card__tags .tag-chip, .work-card__tags span'));
      }, sample.title, { timeout: 30_000 });

      const rendered = await page.evaluate((title) => {
        const cards = [...document.querySelectorAll('#workGrid .work-card')];
        const card = cards.find((candidate) => candidate.querySelector('.work-card__title')?.textContent?.trim() === title);
        if (!card) return null;
        return {
          title: card.querySelector('.work-card__title')?.textContent?.trim() ?? '',
          tags: [...card.querySelectorAll('.work-card__tags .tag-chip, .work-card__tags span')]
            .map((element) => element.textContent?.trim() ?? '')
            .filter(Boolean),
          meta: card.querySelector('.work-card__meta')?.textContent?.trim() ?? '',
        };
      }, sample.title);

      if (!rendered) fail(`rendered card missing: ${sample.title}`);
      if (rendered.tags.includes(COMBINED_TAG)) fail(`live card retains deprecated tag: ${sample.title}`);
      if (!rendered.tags.length) fail(`live card has no rendered tags: ${sample.title}`);
      report.browser_samples.push({ ...rendered, url: page.url() });
    }

    report.status = 'passed';
    report.verified_at = new Date().toISOString();
  } catch (error) {
    report.status = 'failed';
    report.verified_at = new Date().toISOString();
    report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await writeReport(report);
  }
}

await main();
