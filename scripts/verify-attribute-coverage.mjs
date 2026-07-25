import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const ATTRIBUTE_DIR = path.resolve('attributes', 'by-work');
const DIAGNOSTIC_PATH = path.resolve('diagnostics', 'attribute-coverage.json');
const FACETS = ['source', 'genre', 'setting', 'theme', 'motif', 'format'];

async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function fail(message) { throw new Error(message); }

function validateAttribute(record, workId) {
  if (record.schema_version !== '1.1.0') fail(`${workId}: unsupported attribute schema.`);
  if (String(record.work_id) !== workId) fail(`${workId}: attribute work_id mismatch.`);
  if (!record.attribute_source_url?.startsWith('https://animestore.docomo.ne.jp/')) {
    fail(`${workId}: official attribute source URL is missing.`);
  }
  if (!Array.isArray(record.official_genres) || record.official_genres.length === 0) {
    fail(`${workId}: official_genres is empty.`);
  }
  if (!record.primary_genre) fail(`${workId}: primary_genre is missing.`);
  if (!Array.isArray(record.canonical_tags) || record.canonical_tags.length === 0) {
    fail(`${workId}: canonical_tags is empty.`);
  }
  if (!record.attribute_evidence?.primary_genre?.source_url?.startsWith('https://animestore.docomo.ne.jp/')) {
    fail(`${workId}: primary genre evidence is missing.`);
  }
  for (const facet of FACETS) {
    if (!Array.isArray(record.ontology_facets?.[facet])) fail(`${workId}: ontology facet ${facet} is missing.`);
  }
}

function validateEmbedded(work, workId) {
  if (!Array.isArray(work.official_genres) || work.official_genres.length === 0) {
    fail(`${workId}: embedded official_genres is empty.`);
  }
  if (!work.primary_genre) fail(`${workId}: embedded primary_genre is missing.`);
  if (!Array.isArray(work.canonical_tags) || work.canonical_tags.length === 0) {
    fail(`${workId}: embedded canonical_tags is empty.`);
  }
  for (const facet of FACETS) {
    if (!Array.isArray(work.ontology_facets?.[facet])) fail(`${workId}: embedded ontology facet ${facet} is missing.`);
  }
}

async function main() {
  const works = await readJson(path.join(DATA_DIR, 'works.json'));
  const manifest = await readJson(path.join(DATA_DIR, 'manifest.json'));
  const files = (await readdir(ATTRIBUTE_DIR)).filter((name) => /^[A-Za-z0-9_-]+\.json$/u.test(name)).sort();
  const canonicalIds = new Set(works.map((work) => String(work.work_id)));
  const attributeIds = new Set(files.map((name) => name.replace(/\.json$/u, '')));

  const missingIds = [...canonicalIds].filter((id) => !attributeIds.has(id)).sort();
  const staleIds = [...attributeIds].filter((id) => !canonicalIds.has(id)).sort();
  if (missingIds.length) fail(`Missing ${missingIds.length} attribute records; first=${missingIds.slice(0, 10).join(',')}`);
  if (staleIds.length) fail(`Found ${staleIds.length} stale attribute records; first=${staleIds.slice(0, 10).join(',')}`);

  let sourceClassifiedCount = 0;
  const primaryGenreCounts = new Map();
  const canonicalTagCounts = new Map();
  for (const work of works) {
    const workId = String(work.work_id);
    const record = await readJson(path.join(ATTRIBUTE_DIR, `${workId}.json`));
    validateAttribute(record, workId);
    validateEmbedded(work, workId);
    if (record.source_origin) sourceClassifiedCount += 1;
    primaryGenreCounts.set(record.primary_genre, (primaryGenreCounts.get(record.primary_genre) || 0) + 1);
    for (const tag of record.canonical_tags) canonicalTagCounts.set(tag, (canonicalTagCounts.get(tag) || 0) + 1);
  }

  const yearFiles = (await readdir(path.join(DATA_DIR, 'by-year')))
    .filter((name) => /^\d{4}\.json$/u.test(name)).sort();
  const byYear = {};
  for (const filename of yearFiles) {
    const payload = await readJson(path.join(DATA_DIR, 'by-year', filename));
    for (const work of payload.works) validateEmbedded(work, String(work.work_id));
    if (payload.attribute_coverage?.enriched_count !== payload.works.length ||
        payload.attribute_coverage?.total_count !== payload.works.length ||
        payload.attribute_coverage?.coverage_ratio !== 1) {
      fail(`${payload.year}: attribute_coverage is not 100%.`);
    }
    byYear[String(payload.year)] = {
      tagged_count: payload.works.length,
      total_count: payload.works.length,
      coverage_ratio: 1,
    };
  }

  if (manifest.attributes?.cache_record_count !== works.length ||
      manifest.attributes?.applied_canonical_count !== works.length ||
      manifest.attributes?.coverage_ratio !== 1) {
    fail('Manifest attribute totals are not 100% complete.');
  }

  const top = (map, limit = 30) => [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ja'))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
  const report = {
    status: 'passed',
    generated_at: new Date().toISOString(),
    canonical_work_count: works.length,
    attribute_record_count: files.length,
    coverage_ratio: 1,
    source_classified_count: sourceClassifiedCount,
    source_unknown_count: works.length - sourceClassifiedCount,
    by_year: byYear,
    primary_genres: top(primaryGenreCounts),
    canonical_tags: top(canonicalTagCounts),
  };
  await writeJson(DIAGNOSTIC_PATH, report);
  console.log(`Verified 100% attribute coverage: ${works.length} canonical works across ${yearFiles.length} years.`);
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
