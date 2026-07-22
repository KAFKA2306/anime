import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAttributeRecord,
  extractOriginalCredit,
  inferPrimaryGenre,
  inferSourceOrigin,
  parseOfficialDetailText,
} from '../scripts/lib/ontology.mjs';

test('explicit web platform is classified as web novel origin', () => {
  const result = inferSourceOrigin({
    staffText: '原作:山田太郎（「小説家になろう」掲載）／監督:佐藤花子',
  });
  assert.equal(result.value, 'Web小説（なろう・カクヨム系）');
  assert.equal(result.confidence, 'verified');
  assert.deepEqual(result.matched_terms, ['小説家になろう']);
});

test('manga publication credit is not mislabeled as web novel', () => {
  const result = inferSourceOrigin({
    staffText: '原作:赤坂アカ×横槍メンゴ（集英社ヤングジャンプコミックス刊）／監督:平牧大輔',
  });
  assert.equal(result.value, '漫画');
});

test('high fantasy needs official fantasy plus explicit world signal', () => {
  assert.equal(inferPrimaryGenre({
    officialGenres: ['SF/ファンタジー', 'アクション/バトル'],
    synopsis: '異世界に召喚された冒険者が魔王に挑む。',
  }).value, '異世界・ハイファンタジー');
  assert.equal(inferPrimaryGenre({
    officialGenres: ['SF/ファンタジー', '恋愛/ラブコメ'],
    synopsis: '芸能界で真相を追う兄妹の物語。',
  }).value, 'SF・ファンタジー');
});

test('official action genre becomes canonical battle/action tag', () => {
  const record = buildAttributeRecord({
    workId: '1', title: 'テスト作品',
    detailUrl: 'https://animestore.docomo.ne.jp/animestore/ci_pc?workId=1',
    officialGenres: ['アクション/バトル', 'ドラマ/青春'],
    staffText: '原作:テスト（テストコミックス刊）／監督:監督名',
    productionYear: 2024,
  });
  assert.deepEqual(record.canonical_tags, ['バトル・アクション', 'ドラマ・青春']);
  assert.equal(record.primary_genre, 'バトル・アクション');
  assert.equal(record.source_origin, '漫画');
});

test('original credit extraction stops at next staff separator', () => {
  assert.equal(extractOriginalCredit('原作:作者名（電撃文庫刊）／監督:監督名'), '作者名(電撃文庫刊)');
});

test('official detail parser extracts auditable metadata', () => {
  const parsed = parseOfficialDetailText(`
あらすじ ／ ジャンル
異世界に召喚された冒険者が魔王に挑む。
SF/ファンタジー
アクション/バトル
シリーズ／関連のアニメ作品
キャスト ／ スタッフ
[スタッフ]
原作:作者（「カクヨム」掲載）／監督:監督名
[製作年]
2024年
`);
  assert.deepEqual(parsed.officialGenres, ['SF/ファンタジー', 'アクション/バトル']);
  assert.equal(parsed.synopsis, '異世界に召喚された冒険者が魔王に挑む。');
  assert.match(parsed.staffText, /カクヨム/u);
  assert.equal(parsed.productionYear, 2024);
});
