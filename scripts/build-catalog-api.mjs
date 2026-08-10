import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
};

const jsonBytes = (value) => Buffer.from(`${JSON.stringify(stable(value), null, 2)}\n`);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const csvCell = (value) => {
  const text = Array.isArray(value) ? value.join('|') : value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export async function buildCatalogApi({ root = process.cwd(), output = 'api/v1' } = {}) {
  const sourceManifest = JSON.parse(await readFile(path.join(root, 'data/manifest.json'), 'utf8'));
  const works = JSON.parse(await readFile(path.join(root, 'data/works.json'), 'utf8'));
  if (!Array.isArray(works) || works.length === 0) throw new Error('data/works.json must be a non-empty array');

  const seen = new Set();
  for (const [index, work] of works.entries()) {
    if (!work || typeof work !== 'object') throw new Error(`work ${index} is not an object`);
    if (!work.canonical_id || !work.work_id || !work.title) throw new Error(`work ${index} lacks canonical_id, work_id or title`);
    if (seen.has(work.canonical_id)) throw new Error(`duplicate canonical_id: ${work.canonical_id}`);
    seen.add(work.canonical_id);
  }

  const sortedWorks = [...works].sort((a, b) => String(a.canonical_id).localeCompare(String(b.canonical_id), 'en'));
  const facets = new Map();
  const addFacet = (type, value, canonicalId) => {
    if (!value) return;
    const key = `${type}\u0000${value}`;
    const row = facets.get(key) ?? { type, value, work_ids: [] };
    row.work_ids.push(canonicalId);
    facets.set(key, row);
  };

  for (const work of sortedWorks) {
    for (const year of work.years ?? []) addFacet('year', year, work.canonical_id);
    addFacet('primary_genre', work.primary_genre, work.canonical_id);
    addFacet('source_origin', work.source_origin, work.canonical_id);
    addFacet('classification_status', work.classification_status, work.canonical_id);
    for (const tag of work.canonical_tags ?? []) addFacet('tag', tag, work.canonical_id);
  }

  const facetRows = [...facets.values()]
    .map((row) => ({ ...row, count: row.work_ids.length, work_ids: row.work_ids.sort() }))
    .sort((a, b) => a.type.localeCompare(b.type, 'en') || String(a.value).localeCompare(String(b.value), 'ja'));

  const catalogue = {
    schema: 'https://kafka2306.github.io/anime/api/v1/schema/catalog.json',
    api_version: '1.0.0',
    generated_at: sourceManifest.generated_at,
    source: sourceManifest.source,
    count: sortedWorks.length,
    works: sortedWorks,
  };
  const files = new Map();
  files.set('works.json', jsonBytes(catalogue));
  files.set('facets.json', jsonBytes({ api_version: '1.0.0', generated_at: sourceManifest.generated_at, count: facetRows.length, facets: facetRows }));

  const headers = ['canonical_id','work_id','title','years','production_year','favorite_count','my_list_count','primary_genre','source_origin','canonical_tags','classification_status','detail_url','attribute_source_url','attribute_fetched_at'];
  const csv = [headers.join(','), ...sortedWorks.map((work) => headers.map((key) => csvCell(work[key])).join(','))].join('\n') + '\n';
  files.set('works.csv', Buffer.from(csv));

  const outputDir = path.join(root, output);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  for (const [name, bytes] of files) await writeFile(path.join(outputDir, name), bytes);

  const manifest = {
    schema: 'https://kafka2306.github.io/anime/api/v1/schema/manifest.json',
    api_version: '1.0.0',
    generated_at: sourceManifest.generated_at,
    source_schema_version: sourceManifest.schema_version,
    counts: { works: sortedWorks.length, facets: facetRows.length },
    cache: { max_age_seconds: 3600, integrity: 'sha256' },
    files: Object.fromEntries([...files].map(([name, bytes]) => [name, { bytes: bytes.length, sha256: sha256(bytes) }])),
  };
  await writeFile(path.join(outputDir, 'manifest.json'), jsonBytes(manifest));
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = await buildCatalogApi();
  console.log(JSON.stringify(manifest.counts));
}
