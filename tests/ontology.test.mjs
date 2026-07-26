import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTRIBUTE_SCHEMA_VERSION,
  buildAttributeRecord,
  classifySpeculativeGenre,
  extractOriginalCredit,
  inferOntologyFacets,
  inferPrimaryGenre,
  inferSourceOrigin,
  normalizeOfficialGenres,
  parseOfficialDetailText,
  rebuildAttributeRecordFromCache,
} from '../scripts/lib/ontology.mjs';

test('explicit web platform is classified as web novel origin', () => {
  const result = inferSourceOrigin({ staffText: '原作:山田太郎（「小説家になろう」掲載）／監督:佐藤花子' });
  assert.equal(result.value, 'Web小説（なろう・カクヨム系）');
  assert.equal(result.confidence, 'verified');
});

test('generic pixiv credit is not enough to infer web novel', () => {
  assert.equal(inferSourceOrigin({ staffText: '原作:作者名（pixivコミック掲載）／監督:監督名' }).value, '漫画');
});

test('science fiction and fantasy are independent domains', () => {
  assert.deepEqual(classifySpeculativeGenre({ synopsis: '銀河を航行する宇宙船と人工知能の物語。' }).domains, ['SF']);
  assert.deepEqual(classifySpeculativeGenre({ synopsis: '魔法王国で騎士とドラゴンが戦う。' }).domains, ['ファンタジー']);
  assert.deepEqual(classifySpeculativeGenre({ synopsis: '宇宙船で異世界へ転移し魔法を使う。' }).domains, ['SF', 'ファンタジー']);
});

test('high fantasy needs official speculative bucket plus explicit world signal', () => {
  assert.equal(inferPrimaryGenre({
    officialGenres: ['SF/ファンタジー', 'アクション/バトル'],
    synopsis: '異世界に召喚された冒険者が魔王に挑む。',
  }).value, '異世界・ハイファンタジー');
  assert.equal(inferPrimaryGenre({
    officialGenres: ['SF/ファンタジー'],
    synopsis: '銀河系を航行する宇宙船と人工知能の物語。',
  }).value, 'SF');
  assert.equal(inferPrimaryGenre({
    officialGenres: ['SF/ファンタジー'],
    synopsis: '魔法王国の騎士と妖精の物語。',
  }).value, 'ファンタジー');
});

test('ambiguous official speculative bucket is not emitted as a combined canonical tag', () => {
  const record = buildAttributeRecord({
    workId: '7', title: '判定保留',
    detailUrl: 'https://animestore.docomo.ne.jp/animestore/ci_pc?workId=7',
    officialGenres: ['SF/ファンタジー'], synopsis: '不思議な物語。',
  });
  assert.equal(record.primary_genre, 'スペキュレーティブ判定保留');
  assert.ok(!record.canonical_tags.includes('SF・ファンタジー'));
  assert.ok(record.canonical_tags.includes('スペキュレーティブ判定保留'));
  assert.deepEqual(record.speculative_genres, []);
  assert.equal(record.classification_status, 'needs-review');
});

test('ontology facets classify expanded dimensions independently', () => {
  const facets = inferOntologyFacets({
    officialGenres: ['SF/ファンタジー', 'ドラマ/青春'],
    title: '星空学園バンド',
    synopsis: '宇宙の学園で仲間と音楽に挑戦し、魔法の謎を追う。',
    sourceOrigin: '漫画', primaryGenre: 'クロスジャンル',
  });
  assert.deepEqual(facets.genre, ['クロスジャンル', 'SF', 'ファンタジー', 'ドラマ・青春']);
  assert.deepEqual(facets.setting, ['学園', '宇宙']);
  assert.ok(facets.theme.includes('友情・仲間'));
  assert.ok(facets.theme.includes('音楽・アイドル'));
  assert.ok(facets.motif.includes('魔法'));
});

test('record stores reusable official snapshot and no combined speculative canonical tag', () => {
  const record = buildAttributeRecord({
    workId: '3', title: '異世界厨房',
    detailUrl: 'https://animestore.docomo.ne.jp/animestore/ci_pc?workId=3',
    officialGenres: ['SF/ファンタジー', '日常/ほのぼの'],
    synopsis: '異世界の食堂で仲間と料理を作る。',
    staffText: '原作:作者（電撃文庫刊）／監督:監督名',
  });
  assert.equal(record.schema_version, ATTRIBUTE_SCHEMA_VERSION);
  assert.equal(record.primary_genre, '異世界・ハイファンタジー');
  assert.ok(record.canonical_tags.includes('ファンタジー'));
  assert.ok(!record.canonical_tags.includes('SF・ファンタジー'));
  assert.equal(record.official_snapshot.synopsis, '異世界の食堂で仲間と料理を作る。');
  assert.equal(record.official_snapshot.source, 'network');
  assert.match(record.official_snapshot.sha256, /^[a-f0-9]{64}$/u);
});

test('full snapshot is rebuilt without network input', () => {
  const original = buildAttributeRecord({
    workId: '8', title: '宇宙航路',
    detailUrl: 'https://animestore.docomo.ne.jp/animestore/ci_pc?workId=8',
    officialGenres: ['SF/ファンタジー'], synopsis: '銀河を旅する宇宙船。',
    fetchedAt: '2026-07-25T00:00:00.000Z',
  });
  const rebuilt = rebuildAttributeRecordFromCache(original, { title: '宇宙航路' });
  assert.equal(rebuilt.primary_genre, 'SF');
  assert.equal(rebuilt.cache_status, 'full-snapshot-reused');
  assert.equal(rebuilt.attribute_fetched_at, original.attribute_fetched_at);
});

test('official detail parser isolates selected work metadata', () => {
  const parsed = parseOfficialDetailText(`
  あらすじ ／ ジャンル
  銀河を航行する宇宙船の物語。
  SF/ファンタジー アクション/バトル
  シリーズ／関連のアニメ作品
  キャスト ／ スタッフ
  [スタッフ]
  原作:作者（「カクヨム」掲載）／監督:監督名
  [製作年]
  2025年
  `);
  assert.deepEqual(parsed.officialGenres, ['SF/ファンタジー', 'アクション/バトル']);
  assert.match(parsed.staffText, /カクヨム/u);
  assert.equal(parsed.productionYear, 2025);
});

test('original credit extraction stops at next separator', () => {
  assert.equal(extractOriginalCredit('原作:作者名（電撃文庫刊）／監督:監督名'), '作者名(電撃文庫刊)');
});

test('official labels preserve source order', () => {
  assert.deepEqual(
    normalizeOfficialGenres(['説明 SF/ファンタジー アクション/バトル 恋愛/ラブコメ']),
    ['SF/ファンタジー', 'アクション/バトル', '恋愛/ラブコメ'],
  );
});
