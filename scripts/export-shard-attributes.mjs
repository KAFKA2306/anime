import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseShardConfig, selectShard } from './lib/sharding.mjs';

const DATA_DIR = path.resolve('data');
const ATTRIBUTE_DIR = path.resolve('attributes', 'by-work');
const OUTPUT_DIR = path.resolve(process.env.DANIME_ATTRIBUTE_EXPORT_DIR ?? 'dist-attributes');
const ONLY_YEAR = process.env.DANIME_ENRICH_YEAR ? Number(process.env.DANIME_ENRICH_YEAR) : null;
const SHARD = parseShardConfig();

async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function validateRecord(record, work) {
  if (String(record.work_id) !== String(work.work_id)) throw new Error(`work_id mismatch for ${work.work_id}`);
  if (record.schema_version !== '1.1.0') throw new Error(`Unsupported attribute schema for ${work.work_id}`);
  if (!record.attribute_source_url?.startsWith('https://animestore.docomo.ne.jp/')) {
    throw new Error(`Missing official source URL for ${work.work_id}`);
  }
  if (!Array.isArray(record.official_genres) || record.official_genres.length === 0) {
    throw new Error(`Missing official genres for ${work.work_id}`);
  }
  if (!record.primary_genre) throw new Error(`Missing primary genre for ${work.work_id}`);
  if (!Array.isArray(record.canonical_tags) || record.canonical_tags.length === 0) {
    throw new Error(`Missing canonical tags for ${work.work_id}`);
  }
  if (!record.ontology_facets || typeof record.ontology_facets !== 'object' || Array.isArray(record.ontology_facets)) {
    throw new Error(`Missing ontology facets for ${work.work_id}`);
  }
}

async function main() {
  const candidates = ONLY_YEAR
    ? (await readJson(path.join(DATA_DIR, 'by-year', `${ONLY_YEAR}.json`))).works
    : await readJson(path.join(DATA_DIR, 'works.json'));
  const works = selectShard(candidates, SHARD);
  const destination = path.join(OUTPUT_DIR, 'attributes', 'by-work');
  const diagnostics = path.join(OUTPUT_DIR, 'diagnostics', 'shards');
  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await mkdir(diagnostics, { recursive: true });

  for (const work of works) {
    const source = path.join(ATTRIBUTE_DIR, `${work.work_id}.json`);
    const record = await readJson(source).catch(() => null);
    if (!record) throw new Error(`Attribute record not found for ${work.work_id} ${work.title}`);
    validateRecord(record, work);
    await copyFile(source, path.join(destination, `${work.work_id}.json`));
  }

  await writeJson(path.join(diagnostics, `shard-${SHARD.index}.json`), {
    generated_at: new Date().toISOString(),
    requested_year: ONLY_YEAR,
    shard_index: SHARD.index,
    shard_count: SHARD.count,
    exported_count: works.length,
    work_ids: works.map((work) => String(work.work_id)).sort(),
  });
  console.log(`Exported ${works.length} verified attribute records for shard ${SHARD.index}/${SHARD.count}.`);
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
