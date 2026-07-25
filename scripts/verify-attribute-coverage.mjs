import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const ATTRIBUTE_DIR = path.resolve('attributes', 'by-work');
const DIAGNOSTIC_PATH = path.resolve('diagnostics', 'attribute-coverage.json');
const OFFICIAL_ORIGIN = 'https://animestore.docomo.ne.jp';
const FACETS = ['source', 'genre', 'setting', 'theme', 'motif', 'format'];
const EMBEDDED_FIELDS = [
  'attribute_source_url', 'attribute_fetched_at', 'official_genres',
  'production_year', 'original_credit', 'source_origin', 'primary_genre',
  'canonical_tags', 'ontology_facets', 'attribute_confidence', 'attribute_evidence',
];

async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function fail(message) { throw new Error(message); }
function uniqueNonEmptyStrings(values) {
  return Array.isArray(values) && values.length > 0 && values.every((value) => (
    typeof value === 'string' && value.trim() && values.indexOf(value) === values.lastIndexOf(value)
  ));
}

function validateOfficialDetailUrl(value, workId) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${workId}: official attribute source URL is invalid.`);
  }
  if (url.origin !== OFFICIAL_ORIGIN || url.pathname !== '/animestore/ci_pc' ||
      url.searchParams.get('workId') !== workId) {
    fail(`${workId}: official attribute source URL does not match the work.`);
  }
  return url.toString();
}

function validateAttribute(record, workId) {
  if (record.schema_version !== '1.1.0') fail(`${workId}: unsupported attribute schema.`);
  if (String(record.work_id) !== workId) fail(`${workId}: attribute work_id mismatch.`);
  const sourceUrl = validateOfficialDetailUrl(record.attribute_source_url, workId);
  if (!uniqueNonEmptyStrings(record.official_genres)) fail(`${workId}: official_genres is empty or invalid.`);
  if (typeof record.primary_genre !== 'string' || !record.primary_genre.trim()) {
    fail(`${workId}: primary_genre is missing.`);
  }
  if (!uniqueNonEmptyStrings(record.canonical_tags)) fail(`${workId}: canonical_tags is empty or invalid.`);
  if (!record.canonical_tags.includes(record.primary_genre)) {
    fail(`${workId}: canonical_tags does not contain primary_genre.`);
  }
  for (const facet of FACETS) {
    if (!Array.isArray(record.ontology_facets?.[facet])) fail(`${workId}: ontology facet ${facet} is missing.`);
  }
  for (const evidenceKey of ['source_origin', 'primary_genre', 'canonical_tags', 'ontology_facets']) {
    if (record.attribute_evidence?.[evidenceKey]?.source_url !== sourceUrl) {
      fail(`${workId}: ${evidenceKey} evidence does not match the official detail URL.`);
    }
  }
}

function validateEmbedded(work, record, workId) {
  for (const field of EMBEDDED_FIELDS) {
    if (JSON.stringify(work[field]) !== JSON.stringify(record[field])) {
      fail(`${workId}: embedded ${field} disagrees with the attribute cache.`);
    }
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
  const attributes = new Map();
  for (const work of works) {
    const workId = String(work.work_id);
    const record = await readJson(path.join(ATTRIBUTE_DIR, `${workId}.json`));
    validateAttribute(record, workId);
    validateEmbedded(work, record, workId);
    attributes.set(workId, record);
    if (record.source_origin) sourceClassifiedCount += 1;
    primaryGenreCounts.set(record.primary_genre, (primaryGenreCounts.get(record.primary_genre) || 0) + 1);
    for (const tag of record.canonical_tags) canonicalTagCounts.set(tag, (canonicalTagCounts.get(tag) || 0) + 1);
  }

  const yearFiles = (await readdir(path.join(DATA_DIR, 'by-year')))
    .filter((name) => /^\d{4}\.json$/u.test(name)).sort();
  const byYear = {};
  for (const filename of yearFiles) {
    const payload = await readJson(path.join(DATA_DIR, 'by-year', filename));
    for (const work of payload.works) {
      const workId = String(work.work_id);
      const record = attributes.get(workId);
      if (!record) fail(`${payload.year}: ${workId} has no canonical attribute record.`);
      validateEmbedded(work, record, workId);
    }
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
