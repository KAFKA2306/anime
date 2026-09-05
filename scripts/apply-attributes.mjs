import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ATTRIBUTE_SCHEMA_VERSION, ONTOLOGY_VERSION } from './lib/ontology.mjs';

const DATA_DIR = path.resolve('data');
const ATTRIBUTE_DIR = path.resolve('attributes', 'by-work');
const ATTRIBUTE_FIELDS = [
  'ontology_version', 'attribute_source_url', 'attribute_fetched_at', 'cache_status',
  'official_genres', 'production_year', 'original_credit', 'source_origin', 'primary_genre',
  'speculative_genres', 'speculative_genre_status', 'canonical_tags', 'ontology_facets', 'classification_status',
  'attribute_confidence', 'attribute_evidence',
];

async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function selectAttributes(record) {
  return Object.fromEntries(ATTRIBUTE_FIELDS
    .filter((field) => Object.hasOwn(record, field))
    .map((field) => [field, record[field]]));
}

async function loadAttributeMap(canonicalIds) {
  const files = await readdir(ATTRIBUTE_DIR).catch(() => []);
  const map = new Map();
  let prunedCount = 0;
  for (const filename of files.filter((name) => /^[A-Za-z0-9_-]+\.json$/u.test(name)).sort()) {
    const record = await readJson(path.join(ATTRIBUTE_DIR, filename));
    if (!record.work_id || filename !== `${record.work_id}.json`) {
      throw new Error(`Invalid attribute cache filename or work_id: ${filename}`);
    }
    if (record.schema_version !== ATTRIBUTE_SCHEMA_VERSION || record.ontology_version !== ONTOLOGY_VERSION) {
      throw new Error(`Attribute record ${record.work_id} is not rebuilt for ontology ${ONTOLOGY_VERSION}.`);
    }
    if (!record.attribute_source_url?.startsWith('https://animestore.docomo.ne.jp/')) {
      throw new Error(`Attribute record ${record.work_id} lacks an official source URL.`);
    }
    const workId = String(record.work_id);
    if (!canonicalIds.has(workId)) {
      await unlink(path.join(ATTRIBUTE_DIR, filename));
      prunedCount += 1;
      continue;
    }
    map.set(workId, record);
  }
  return { map, prunedCount };
}

async function main() {
  const worksPath = path.join(DATA_DIR, 'works.json');
  const works = await readJson(worksPath);
  const canonicalIds = new Set(works.map((work) => String(work.work_id)));
  const { map: attributes, prunedCount } = await loadAttributeMap(canonicalIds);
  const yearDir = path.join(DATA_DIR, 'by-year');
  const yearFiles = (await readdir(yearDir)).filter((name) => /^\d{4}\.json$/u.test(name)).sort();
  let appliedMembershipCount = 0;
  const coverageByYear = {};

  for (const filename of yearFiles) {
    const file = path.join(yearDir, filename);
    const payload = await readJson(file);
    let enrichedCount = 0;
    payload.works = payload.works.map((work) => {
      const record = attributes.get(String(work.work_id));
      if (!record) return work;
      enrichedCount += 1;
      appliedMembershipCount += 1;
      return { ...work, ...selectAttributes(record) };
    });
    payload.attribute_coverage = {
      enriched_count: enrichedCount,
      total_count: payload.works.length,
      coverage_ratio: payload.works.length ? enrichedCount / payload.works.length : 0,
      ontology_version: ONTOLOGY_VERSION,
    };
    coverageByYear[String(payload.year)] = payload.attribute_coverage;
    await writeJson(file, payload);
  }

  let appliedCanonicalCount = 0;
  const enrichedWorks = works.map((work) => {
    const record = attributes.get(String(work.work_id));
    if (!record) return work;
    appliedCanonicalCount += 1;
    return { ...work, ...selectAttributes(record) };
  });
  await writeJson(worksPath, enrichedWorks);

  const records = [...attributes.values()];
  const sourceClassifiedCount = records.filter((record) => record.source_origin).length;
  const fullSnapshotCount = records.filter((record) => record.official_snapshot?.source === 'network').length;
  const needsReviewCount = records.filter((record) => record.classification_status === 'needs-review').length;
  const manifestPath = path.join(DATA_DIR, 'manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.attributes = {
    schema_version: ATTRIBUTE_SCHEMA_VERSION,
    ontology_version: ONTOLOGY_VERSION,
    cache_record_count: attributes.size,
    applied_canonical_count: appliedCanonicalCount,
    applied_membership_count: appliedMembershipCount,
    coverage_ratio: works.length ? appliedCanonicalCount / works.length : 0,
    source_classified_count: sourceClassifiedCount,
    source_unknown_count: attributes.size - sourceClassifiedCount,
    full_snapshot_count: fullSnapshotCount,
    legacy_cache_count: attributes.size - fullSnapshotCount,
    classified_count: attributes.size - needsReviewCount,
    needs_review_count: needsReviewCount,
    by_year: coverageByYear,
    fields: ['source_origin', 'primary_genre', 'speculative_genres', 'speculative_genre_status', 'canonical_tags', 'ontology_facets', 'classification_status'],
    ontology_facets: ['source', 'genre', 'subgenre', 'setting', 'theme', 'motif', 'format'],
    speculative_genre_policy: 'SF and fantasy are independent canonical domains; the official combined bucket is retained only as source metadata.',
    cache_policy: 'Reclassification is local and cache-first. Network access is limited to missing records or explicit raw-snapshot backfill.',
  };
  await writeJson(manifestPath, manifest);

  if (prunedCount) console.log(`Pruned ${prunedCount} stale attribute cache record(s) absent from the canonical catalogue.`);
  console.log(
    `Applied ${attributes.size} ontology ${ONTOLOGY_VERSION} records to ${appliedCanonicalCount} canonical works ` +
    `and ${appliedMembershipCount} year memberships.`,
  );
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
