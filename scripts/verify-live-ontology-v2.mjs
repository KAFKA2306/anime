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
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const url = `${SITE}/${path}?verify=${Date.now()}-${attempt}`;
    const response = await fetch(url, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
    const body = Buffer.from(await response.arrayBuffer());
    last = { status: response.status, hash: sha256(body), url };
    if (response.ok && last.hash === expectedHash) return { ...last, body };
    await sleep(10_000);
  }
  fail(`${path}: public hash did not converge to repository hash; last=${JSON.stringify(last)}`);
}

async function main() {
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

  const publicFiles = {};
  for (const path of FILES) {
    const result = await fetchPublicExact(path, local[path].hash);
    publicFiles[path] = { url: result.url, status: result.status, sha256: result.hash };
  }

  const public2024 = JSON.parse((await fetchPublicExact('data/by-year/2024.json', local['data/by-year/2024.json'].hash)).body.toString('utf8'));
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

  const browser = await chromium.launch({ headless: true });
  const browserSamples = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'ja-JP' });
    for (const sample of samples) {
      const url = `${SITE}/?year=2024&q=${encodeURIComponent(sample.title)}&verify=${Date.now()}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await page.locator('#loadingState').waitFor({ state: 'hidden', timeout: 90_000 });
      const card = page.locator('#workGrid .work-card').filter({ hasText: sample.title }).first();
      await card.waitFor({ state: 'visible', timeout: 90_000 });
      const renderedTitle = (await card.locator('.work-card__title').textContent())?.trim();
      if (renderedTitle !== sample.title) fail(`rendered title mismatch: ${sample.title}`);
      const tags = (await card.locator('.work-card__tags span').allTextContents()).map((value) => value.trim()).filter(Boolean);
      if (tags.includes(COMBINED_TAG)) fail(`live card retains deprecated tag: ${sample.title}`);
      if (!tags.length) fail(`live card has no rendered tags: ${sample.title}`);
      browserSamples.push({ title: sample.title, url: page.url(), rendered_tags: tags });
    }
  } finally {
    await browser.close();
  }

  const report = {
    status: 'passed',
    verified_at: new Date().toISOString(),
    site: `${SITE}/`,
    repository_head_sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    data_commit_sha: execFileSync('git', ['log', '-1', '--format=%H', '--', 'data/by-year/2025.json'], { encoding: 'utf8' }).trim(),
    catalogue: {
      year_count: manifest.year_count,
      canonical_work_count: manifest.canonical_work_count,
      membership_count: manifest.membership_count,
      ontology_version: manifest.attributes.ontology_version,
      coverage_ratio: manifest.attributes.coverage_ratio,
      year_2024_count: local['data/by-year/2024.json'].json.works.length,
      year_2025_count: local['data/by-year/2025.json'].json.works.length,
      deprecated_combined_tag_count: 0,
    },
    public_files: publicFiles,
    public_json_samples: samples,
    browser_samples: browserSamples,
  };

  await mkdir('verification', { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
