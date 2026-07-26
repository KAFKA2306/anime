import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ONTOLOGY_VERSION, rebuildAttributeRecordFromCache } from './lib/ontology.mjs';

const DATA_DIR = path.resolve('data');
const ATTRIBUTE_DIR = path.resolve('attributes', 'by-work');
const DIAGNOSTIC_PATH = path.resolve('diagnostics', 'attribute-cache-rebuild.json');
const ONLY_YEAR = process.env.DANIME_REBUILD_YEAR ? Number(process.env.DANIME_REBUILD_YEAR) : null;

async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function sameJson(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

async function candidateTitleMap() {
  const works = ONLY_YEAR
    ? (await readJson(path.join(DATA_DIR, 'by-year', `${ONLY_YEAR}.json`))).works
    : await readJson(path.join(DATA_DIR, 'works.json'));
  return new Map(works.map((work) => [String(work.work_id), String(work.title || '')]));
}

async function main() {
  const titleById = await candidateTitleMap();
  const files = (await readdir(ATTRIBUTE_DIR))
    .filter((name) => /^[A-Za-z0-9_-]+\.json$/u.test(name)).sort();
  const stats = {
    ontology_version: ONTOLOGY_VERSION,
    requested_year: ONLY_YEAR,
    candidate_count: titleById.size,
    inspected_count: 0,
    changed_count: 0,
    unchanged_count: 0,
    full_snapshot_count: 0,
    legacy_cache_count: 0,
    classified_count: 0,
    needs_review_count: 0,
  };

  for (const filename of files) {
    const workId = filename.replace(/\.json$/u, '');
    if (!titleById.has(workId)) continue;
    const file = path.join(ATTRIBUTE_DIR, filename);
    const previous = await readJson(file);
    const rebuilt = rebuildAttributeRecordFromCache(previous, { title: titleById.get(workId) });
    stats.inspected_count += 1;
    if (rebuilt.official_snapshot?.source === 'network') stats.full_snapshot_count += 1;
    else stats.legacy_cache_count += 1;
    if (rebuilt.classification_status === 'needs-review') stats.needs_review_count += 1;
    else stats.classified_count += 1;

    if (sameJson(previous, rebuilt)) {
      stats.unchanged_count += 1;
      continue;
    }
    await writeJson(file, rebuilt);
    stats.changed_count += 1;
  }

  if (stats.inspected_count !== titleById.size) {
    throw new Error(`Attribute cache incomplete: inspected=${stats.inspected_count}, candidates=${titleById.size}.`);
  }

  await writeJson(DIAGNOSTIC_PATH, { generated_at: new Date().toISOString(), network_requests: 0, ...stats });
  console.log(
    `Rebuilt ${stats.inspected_count} cached records with ontology ${ONTOLOGY_VERSION}; ` +
    `changed=${stats.changed_count}, network_requests=0.`,
  );
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
