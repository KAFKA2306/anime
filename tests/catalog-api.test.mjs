import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { buildCatalogApi } from '../scripts/build-catalog-api.mjs';

const fixture = async (works) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'anime-api-'));
  await mkdir(path.join(root, 'data'));
  await writeFile(path.join(root, 'data/manifest.json'), JSON.stringify({
    schema_version: '2.0.0', generated_at: '2026-08-07T00:00:00.000Z', source: { name: 'official' }
  }));
  await writeFile(path.join(root, 'data/works.json'), JSON.stringify(works));
  return root;
};

const work = (id, overrides = {}) => ({
  canonical_id: `danime:${id}`, work_id: String(id), title: `Work ${id}`, years: [2026],
  canonical_tags: ['SF'], primary_genre: 'SF', classification_status: 'classified', ...overrides
});

test('builds deterministic JSON, CSV, facet index and checksums', async () => {
  const root = await fixture([work(2), work(1)]);
  const manifest = await buildCatalogApi({ root });
  assert.equal(manifest.counts.works, 2);
  const api = JSON.parse(await readFile(path.join(root, 'api/v1/works.json')));
  assert.deepEqual(api.works.map((row) => row.canonical_id), ['danime:1', 'danime:2']);
  const facets = JSON.parse(await readFile(path.join(root, 'api/v1/facets.json')));
  assert.ok(facets.facets.some((row) => row.type === 'tag' && row.value === 'SF' && row.count === 2));
  for (const [name, metadata] of Object.entries(manifest.files)) {
    const bytes = await readFile(path.join(root, 'api/v1', name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.sha256);
  }
});

test('rejects duplicate canonical ids', async () => {
  const root = await fixture([work(1), work(1)]);
  await assert.rejects(() => buildCatalogApi({ root }), /duplicate canonical_id/);
});

test('rejects missing primary identifiers', async () => {
  const root = await fixture([{ title: 'broken' }]);
  await assert.rejects(() => buildCatalogApi({ root }), /lacks canonical_id/);
});
