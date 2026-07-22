import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeCanonical,
  normalizeText,
  parseYear,
  sanitizeTitle,
  tagIdFromUrl,
  workIdFromUrl,
} from '../scripts/lib/catalog.mjs';

test('normalizes Japanese catalogue text', () => {
  assert.equal(normalizeText(' 作品\n  タイトル '), '作品 タイトル');
  assert.equal(sanitizeTitle('気になる 作品タイトル'), '作品タイトル');
});

test('parses official identifiers and exact years', () => {
  assert.equal(parseYear('2024年アニメ'), 2024);
  assert.equal(parseYear('2020年代'), null);
  assert.equal(tagIdFromUrl('/animestore/tag_pc?tagId=T0021150'), 'T0021150');
  assert.equal(workIdFromUrl('/animestore/ci_pc?workId=12345'), '12345');
});

test('merges duplicate work IDs into canonical year memberships', () => {
  const result = mergeCanonical({
    2023: [{ work_id: 'A1', title: '作品A', detail_url: 'https://example.test/A1', image_url: null }],
    2024: [{ work_id: 'A1', title: '作品A', detail_url: 'https://example.test/A1', image_url: 'https://example.test/A1.jpg' }],
  });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].years, [2023, 2024]);
  assert.equal(result[0].image_url, 'https://example.test/A1.jpg');
});
