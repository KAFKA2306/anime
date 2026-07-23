import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAttributeRecord,
  extractOriginalCredit,
  inferOntologyFacets,
  inferPrimaryGenre,
  inferSourceOrigin,
  normalizeOfficialGenres,
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

test('generic pixiv credit is not enough to infer web novel', () => {
  const result = inferSourceOrigin({ staffText: '原作:作者名（pixivコミック掲載）／監督:監督名' });
  assert.equal(result.value, '漫画');
});

test('manga publication credit is not mislabeled as web novel', () => {
  const result = inferSourceOrigin({
    staffText: '原作:赤坂アカ×横槍メンゴ（集英社ヤングジャンプコミックス刊）／監督:平牧大輔',
  });
  assert.equal(result.value, '漫画');
});

test('high fantasy needs official fantasy plus a strong world signal', () => {
  assert.equal(inferPrimaryGenre({
    officialGenres: ['SF/ファンタジー', 'アクション/バトル'],
    synopsis: '異世界に召喚された冒険者が魔王に挑む。',
  }).value, '異世界・ハイファンタジー');
  assert.equal(inferPrimaryGenre({
    officialGenres: ['SF/ファンタジー', '恋愛/ラブコメ'],
    synopsis: '現代の学校で魔法を学ぶ少年少女の物語。',
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
  assert.equal(record.source_origin, '漫画');
  assert.equal(record.production_year, 2024);
  assert.deepEqual(record.ontology_facets.source, ['漫画']);
});

test('ontology facets classify setting, theme and motif independently', () => {
  const facets = inferOntologyFacets({
    officialGenres: ['SF/ファンタジー', 'ドラマ/青春'],
    title: '星空学園バンド',
    synopsis: '宇宙の学園で仲間と音楽に挑戦し、魔法の謎を追う。',
    sourceOrigin: '漫画',
    primaryGenre: 'SF・ファンタジー',
  });
  assert.deepEqual(facets.source, ['漫画']);
  assert.deepEqual(facets.setting, ['学園', '宇宙']);
  assert.deepEqual(facets.theme, ['友情・仲間', '成長・挑戦', '音楽・アイドル']);
  assert.deepEqual(facets.motif, ['魔法']);
});

test('derived ontology tags are included in canonical tags', () => {
  const record = buildAttributeRecord({
    workId: '3', title: '異世界厨房',
    detailUrl: 'https://animestore.docomo.ne.jp/animestore/ci_pc?workId=3',
    officialGenres: ['SF/ファンタジー', '日常/ほのぼの'],
    synopsis: '異世界の食堂で仲間と料理を作る。',
    staffText: '原作:作者（電撃文庫刊）／監督:監督名',
  });
  assert.deepEqual(record.canonical_tags, [
    '異世界・ハイファンタジー', 'SF・ファンタジー', '日常・ほのぼの',
    '異世界', '友情・仲間', '料理・グルメ',
  ]);
  assert.equal(record.schema_version, '1.1.0');
});

test('missing production year remains null', () => {
  const record = buildAttributeRecord({
    workId: '2', title: '年不明',
    detailUrl: 'https://animestore.docomo.ne.jp/animestore/ci_pc?workId=2',
    officialGenres: ['ドラマ/青春'],
  });
  assert.equal(record.production_year, null);
});

test('concatenated official genre labels preserve source order', () => {
  assert.deepEqual(
    normalizeOfficialGenres(['説明文 SF/ファンタジー アクション/バトル 恋愛/ラブコメ']),
    ['SF/ファンタジー', 'アクション/バトル', '恋愛/ラブコメ'],
  );
});

test('original credit extraction stops at next staff separator', () => {
  assert.equal(extractOriginalCredit('原作:作者名（電撃文庫刊）／監督:監督名'), '作者名(電撃文庫刊)');
});

test('official detail parser uses only the selected work genre section', () => {
  const parsed = parseOfficialDetailText(`
グローバルナビゲーション
コメディ/ギャグ
恋愛/ラブコメ
あらすじ ／ ジャンル
異世界に召喚された冒険者が魔王に挑む。
SF/ファンタジー アクション/バトル
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
