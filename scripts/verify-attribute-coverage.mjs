import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ATTRIBUTE_SCHEMA_VERSION, ONTOLOGY_VERSION } from './lib/ontology.mjs';

const DATA_DIR = path.resolve('data');
const ATTRIBUTE_DIR = path.resolve('attributes', 'by-work');
const DIAGNOSTIC_PATH = path.resolve('diagnostics', 'attribute-coverage.json');
const OFFICIAL_ORIGIN = 'https://animestore.docomo.ne.jp';
const FACETS = ['source', 'genre', 'subgenre', 'setting', 'theme', 'motif', 'format'];
const EMBEDDED_FIELDS = [
  'ontology_version', 'attribute_source_url', 'attribute_fetched_at', 'cache_status',
  'official_genres', 'production_year', 'original_credit', 'source_origin', 'primary_genre',
  'speculative_genres', 'speculative_genre_status', 'canonical_tags', 'ontology_facets',
  'classification_status', 'attribute_confidence', 'attribute_evidence',
];

async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function fail(message) { throw new Error(message); }
function uniqueStrings(values, { allowEmpty = true } = {}) {
  return Array.isArray(values)
    && (allowEmpty || values.length > 0)
    && values.every((value, index) => typeof value === 'string' && value.trim() && values.indexOf(value) === index);
}
function stableHash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function validateOfficialDetailUrl(value, workId) {
  let url;
  try { url = new URL(value); } catch { fail(`${workId}: official attribute source URL is invalid.`); }
  if (url.origin !== OFFICIAL_ORIGIN || url.pathname !== '/animestore/ci_pc' ||
      url.searchParams.get('workId') !== workId) {
    fail(`${workId}: official attribute source URL does not match the work.`);
  }
  return url.toString();
}

function validateSnapshot(record, workId) {
  const snapshot = record.official_snapshot;
  if (!snapshot || !['network', 'legacy-derived'].includes(snapshot.source)) {
    fail(`${workId}: reusable official_snapshot provenance is missing.`);
  }
  if (!uniqueStrings(snapshot.official_genres, { allowEmpty: false })) {
    fail(`${workId}: official_snapshot genres are empty or invalid.`);
  }
  const payload = {
    title: String(snapshot.title || ''),
    synopsis: String(snapshot.synopsis || ''),
    staff_text: String(snapshot.staff_text || ''),
    official_genres: snapshot.official_genres,
    production_year: snapshot.production_year ?? null,
  };
  if (snapshot.sha256 !== stableHash(payload)) fail(`${workId}: official_snapshot hash mismatch.`);
}

function validateSpeculativeSeparation(record, workId) {
  if (record.canonical_tags.includes('SF・ファンタジー')) {
    fail(`${workId}: deprecated combined SF・ファンタジー canonical tag remains.`);
  }
  if (!uniqueStrings(record.speculative_genres)) fail(`${workId}: speculative_genres is invalid.`);
  if (record.speculative_genres.some((value) => !['SF', 'ファンタジー'].includes(value))) {
    fail(`${workId}: speculative_genres contains a non-leaf value.`);
  }
  const isOfficialCombined = record.official_genres.includes('SF/ファンタジー');
  if (!isOfficialCombined && record.speculative_genre_status !== 'not-applicable') {
    fail(`${workId}: speculative status must be not-applicable without official combined bucket.`);
  }
  if (isOfficialCombined) {
    if (record.speculative_genres.length) {
      if (record.speculative_genre_status !== 'classified') fail(`${workId}: classified speculative leaves have wrong status.`);
      for (const leaf of record.speculative_genres) {
        if (!record.canonical_tags.includes(leaf)) fail(`${workId}: canonical tags omit speculative leaf ${leaf}.`);
      }
    } else {
      if (record.speculative_genre_status !== 'needs-review') fail(`${workId}: unresolved speculative bucket is not reviewable.`);
      if (!record.canonical_tags.includes('スペキュレーティブ判定保留')) {
        fail(`${workId}: unresolved speculative bucket lacks an explicit pending tag.`);
      }
    }
  }
}

function validateAttribute(record, workId) {
  if (record.schema_version !== ATTRIBUTE_SCHEMA_VERSION) fail(`${workId}: unsupported attribute schema.`);
  if (record.ontology_version !== ONTOLOGY_VERSION) fail(`${workId}: stale ontology version.`);
  if (String(record.work_id) !== workId) fail(`${workId}: attribute work_id mismatch.`);
  const sourceUrl = validateOfficialDetailUrl(record.attribute_source_url, workId);
  validateSnapshot(record, workId);
  if (!uniqueStrings(record.official_genres, { allowEmpty: false })) fail(`${workId}: official_genres is empty or invalid.`);
  if (typeof record.primary_genre !== 'string' || !record.primary_genre.trim()) fail(`${workId}: primary_genre is missing.`);
  if (!uniqueStrings(record.canonical_tags, { allowEmpty: false })) fail(`${workId}: canonical_tags is empty or invalid.`);
  if (!record.canonical_tags.includes(record.primary_genre)) {
    fail(`${workId}: canonical_tags does not contain primary_genre.`);
  }
  if (!['classified', 'needs-review'].includes(record.classification_status)) {
    fail(`${workId}: classification_status is invalid.`);
  }
  validateSpeculativeSeparation(record, workId);
  for (const facet of FACETS) {
    if (!uniqueStrings(record.ontology_facets?.[facet])) fail(`${workId}: ontology facet ${facet} is missing or invalid.`);
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
  let fullSnapshotCount = 0;
  let needsReviewCount = 0;
  const primaryGenreCounts = new Map();
  const canonicalTagCounts = new Map();
  const speculativeCounts = new Map([['SF', 0], ['ファンタジー', 0], ['both', 0], ['needs-review', 0]]);
  const attributes = new Map();
  for (const work of works) {
    const workId = String(work.work_id);
    const record = await readJson(path.join(ATTRIBUTE_DIR, `${workId}.json`));
    validateAttribute(record, workId);
    validateEmbedded(work, record, workId);
    attributes.set(workId, record);
    if (record.source_origin) sourceClassifiedCount += 1;
    if (record.official_snapshot.source === 'network') fullSnapshotCount += 1;
    if (record.classification_status === 'needs-review') needsReviewCount += 1;
    primaryGenreCounts.set(record.primary_genre, (primaryGenreCounts.get(record.primary_genre) || 0) + 1);
    for (const tag of record.canonical_tags) canonicalTagCounts.set(tag, (canonicalTagCounts.get(tag) || 0) + 1);
    if (record.speculative_genres.includes('SF')) speculativeCounts.set('SF', speculativeCounts.get('SF') + 1);
    if (record.speculative_genres.includes('ファンタジー')) speculativeCounts.set('ファンタジー', speculativeCounts.get('ファンタジー') + 1);
    if (record.speculative_genres.length === 2) speculativeCounts.set('both', speculativeCounts.get('both') + 1);
    if (record.speculative_genre_status === 'needs-review') speculativeCounts.set('needs-review', speculativeCounts.get('needs-review') + 1);
  }

  const yearFiles = (await readdir(path.join(DATA_DIR, 'by-year')))
    .filter((name) => /^\d{4}\.json$/u.test(name)).sort();
  const byYear = {};
  for (const filename of yearFiles) {
    const payload = await readJson(path.join(DATA_DIR, 'by-year', filename));
    let sf = 0;
    let fantasy = 0;
    let both = 0;
    let needsReview = 0;
    let fullSnapshots = 0;
    for (const work of payload.works) {
      const workId = String(work.work_id);
      const record = attributes.get(workId);
      if (!record) fail(`${payload.year}: ${workId} has no canonical attribute record.`);
      validateEmbedded(work, record, workId);
      if (record.speculative_genres.includes('SF')) sf += 1;
      if (record.speculative_genres.includes('ファンタジー')) fantasy += 1;
      if (record.speculative_genres.length === 2) both += 1;
      if (record.classification_status === 'needs-review') needsReview += 1;
      if (record.official_snapshot.source === 'network') fullSnapshots += 1;
    }
    if (payload.attribute_coverage?.enriched_count !== payload.works.length ||
        payload.attribute_coverage?.total_count !== payload.works.length ||
        payload.attribute_coverage?.coverage_ratio !== 1 ||
        payload.attribute_coverage?.ontology_version !== ONTOLOGY_VERSION) {
      fail(`${payload.year}: attribute_coverage is not 100% on ontology ${ONTOLOGY_VERSION}.`);
    }
    byYear[String(payload.year)] = {
      tagged_count: payload.works.length,
      total_count: payload.works.length,
      coverage_ratio: 1,
      sf_count: sf,
      fantasy_count: fantasy,
      sf_fantasy_cross_count: both,
      needs_review_count: needsReview,
      full_snapshot_count: fullSnapshots,
    };
  }

  if (manifest.attributes?.cache_record_count !== works.length ||
      manifest.attributes?.applied_canonical_count !== works.length ||
      manifest.attributes?.coverage_ratio !== 1 ||
      manifest.attributes?.ontology_version !== ONTOLOGY_VERSION) {
    fail('Manifest attribute totals or ontology version are incomplete.');
  }

  const top = (map, limit = 40) => [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ja'))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
  const report = {
    status: 'passed',
    generated_at: new Date().toISOString(),
    schema_version: ATTRIBUTE_SCHEMA_VERSION,
    ontology_version: ONTOLOGY_VERSION,
    canonical_work_count: works.length,
    attribute_record_count: files.length,
    coverage_ratio: 1,
    source_classified_count: sourceClassifiedCount,
    source_unknown_count: works.length - sourceClassifiedCount,
    full_snapshot_count: fullSnapshotCount,
    legacy_cache_count: works.length - fullSnapshotCount,
    classified_count: works.length - needsReviewCount,
    needs_review_count: needsReviewCount,
    speculative_genres: Object.fromEntries(speculativeCounts),
    by_year: byYear,
    primary_genres: top(primaryGenreCounts),
    canonical_tags: top(canonicalTagCounts),
  };
  await writeJson(DIAGNOSTIC_PATH, report);
  console.log(
    `Verified 100% attribute coverage: ${works.length} works across ${yearFiles.length} years; ` +
    `SF=${speculativeCounts.get('SF')}, fantasy=${speculativeCounts.get('ファンタジー')}, ` +
    `review=${needsReviewCount}.`,
  );
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
