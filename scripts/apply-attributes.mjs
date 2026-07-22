import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const ATTRIBUTE_DIR = path.resolve('attributes', 'by-work');
const ATTRIBUTE_FIELDS = [
  'attribute_source_url',
  'attribute_fetched_at',
  'official_genres',
  'production_year',
  'original_credit',
  'source_origin',
  'primary_genre',
  'canonical_tags',
  'attribute_confidence',
  'attribute_evidence',
];

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function selectAttributes(record) {
  return Object.fromEntries(ATTRIBUTE_FIELDS
    .filter((field) => Object.hasOwn(record, field))
    .map((field) => [field, record[field]]));
}

async function loadAttributeMap() {
  const files = await readdir(ATTRIBUTE_DIR).catch(() => []);
  const map = new Map();
  for (const filename of files.filter((name) => /^[A-Za-z0-9_-]+\.json$/u.test(name)).sort()) {
    const record = await readJson(path.join(ATTRIBUTE_DIR, filename));
    if (!record.work_id || filename !== `${record.work_id}.json`) {
      throw new Error(`Invalid attribute cache filename or work_id: ${filename}`);
    }
    if (!record.attribute_source_url?.startsWith('https://animestore.docomo.ne.jp/')) {
      throw new Error(`Attribute record ${record.work_id} lacks an official source URL.`);
    }
    map.set(String(record.work_id), record);
  }
  return map;
}

async function main() {
  const attributes = await loadAttributeMap();
  const yearDir = path.join(DATA_DIR, 'by-year');
  const yearFiles = (await readdir(yearDir))
    .filter((name) => /^\d{4}\.json$/u.test(name))
    .sort();

  let appliedMembershipCount = 0;
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
    };
    await writeJson(file, payload);
  }

  const worksPath = path.join(DATA_DIR, 'works.json');
  const works = await readJson(worksPath);
  let appliedCanonicalCount = 0;
  const enrichedWorks = works.map((work) => {
    const record = attributes.get(String(work.work_id));
    if (!record) return work;
    appliedCanonicalCount += 1;
    return { ...work, ...selectAttributes(record) };
  });
  await writeJson(worksPath, enrichedWorks);

  const manifestPath = path.join(DATA_DIR, 'manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.attributes = {
    schema_version: '1.0.0',
    cache_record_count: attributes.size,
    applied_canonical_count: appliedCanonicalCount,
    applied_membership_count: appliedMembershipCount,
    fields: ['source_origin', 'primary_genre', 'canonical_tags'],
    policy: 'Official detail metadata plus deterministic, auditable rules; unknown values remain null.',
  };
  await writeJson(manifestPath, manifest);

  console.log(
    `Applied ${attributes.size} attribute records to ${appliedCanonicalCount} canonical works ` +
    `and ${appliedMembershipCount} year memberships.`,
  );
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
