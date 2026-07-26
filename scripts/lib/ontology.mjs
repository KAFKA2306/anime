import { createHash } from 'node:crypto';

export const ATTRIBUTE_SCHEMA_VERSION = '2.0.0';
export const ONTOLOGY_VERSION = '2.0.0';

const OFFICIAL_GENRE_LABELS = [
  'SF/ファンタジー', 'ロボット/メカ', 'アクション/バトル', 'コメディ/ギャグ',
  '恋愛/ラブコメ', '日常/ほのぼの', 'スポーツ/競技', 'ホラー/サスペンス/推理',
  '歴史/戦記', '戦争/ミリタリー', 'ドラマ/青春', 'キッズ/ファミリー',
  'ショート', '2.5次元舞台', 'ライブ/ラジオ/etc.',
];

export const OFFICIAL_GENRES = [...OFFICIAL_GENRE_LABELS];

const OFFICIAL_CANONICAL_MAP = new Map([
  ['ロボット/メカ', 'ロボット・メカ'],
  ['アクション/バトル', 'バトル・アクション'],
  ['コメディ/ギャグ', 'コメディ・ギャグ'],
  ['恋愛/ラブコメ', '恋愛・ラブコメ'],
  ['日常/ほのぼの', '日常・ほのぼの'],
  ['スポーツ/競技', 'スポーツ・競技'],
  ['ホラー/サスペンス/推理', 'ホラー・サスペンス・ミステリー'],
  ['歴史/戦記', '歴史・戦記'],
  ['戦争/ミリタリー', '戦争・ミリタリー'],
  ['ドラマ/青春', 'ドラマ・青春'],
  ['キッズ/ファミリー', 'キッズ・ファミリー'],
  ['ショート', 'ショート'],
  ['2.5次元舞台', '2.5次元舞台'],
  ['ライブ/ラジオ/etc.', 'ライブ・ラジオ・その他'],
]);

const WEB_NOVEL_PLATFORMS = [
  '小説家になろう', 'カクヨム', 'アルファポリス', 'エブリスタ', 'ノベルアップ+',
  'ノベルアップ＋', '魔法のiらんど', 'pixiv小説', 'Arcadia', 'ハーメルン',
];
const MANGA_SIGNALS = [
  'コミックス', 'コミック', '漫画', '少年ジャンプ', 'ヤングジャンプ', '週刊少年',
  '月刊少年', 'マーガレット', '花とゆめ', 'モーニング', 'アフタヌーン',
  'ビッグコミック', 'ガンガン', 'サンデー', 'マガジン', 'チャンピオン',
  'ヤングマガジン', 'マンガ', 'webコミック', 'pixivコミック',
];
const NOVEL_SIGNALS = ['文庫', 'ノベル', '小説', 'ブックス', 'BOOKS'];
const GAME_SIGNALS = ['ゲーム', 'スマートフォンゲーム', 'アプリゲーム', 'ブラウザゲーム'];
const VISUAL_NOVEL_SIGNALS = ['ビジュアルノベル', 'アドベンチャーゲーム', '恋愛ゲーム'];
const ORIGINAL_SIGNALS = ['オリジナルアニメ', '原作なし'];

const SPECULATIVE_SIGNALS = {
  sf: [
    '宇宙', '銀河', '惑星', '星間', '宇宙船', '人工知能', 'AI', 'アンドロイド', 'サイボーグ',
    'ロボット', 'メカ', '機動兵器', '科学', '未来', '近未来', 'タイムマシン', '時間旅行',
    'タイムリープ', '並行世界', '仮想現実', 'VR', '電脳', 'サイバーパンク', 'クローン',
    '遺伝子', '地球外生命', '宇宙人', 'エイリアン', '超技術', 'ディストピア',
  ],
  fantasy: [
    '魔法', '魔術', '魔導', '魔王', '勇者', '異世界', '転生', '転移', '召喚', '王国',
    '王女', '王子', '騎士', '聖女', '賢者', '冒険者', 'ダンジョン', 'ギルド', '剣と魔法',
    'エルフ', 'ドワーフ', 'ドラゴン', '竜', '妖精', '精霊', '悪魔', '天使', '神々',
    '呪術', '錬金術', 'モンスター', '魔獣', '幻獣',
  ],
};

const HIGH_FANTASY_SIGNALS = [
  '異世界', '転生', '転移', '召喚', '勇者', '魔王', '冒険者', 'ダンジョン',
  'ギルド', '剣と魔法', 'エルフ', 'ドワーフ', '聖女', '賢者',
];

const FACET_RULES = {
  setting: [
    ['異世界', ['異世界', '転生', '転移', '召喚']],
    ['学園', ['学園', '学校', '高校', '中学校', '大学', '部活']],
    ['宇宙', ['宇宙', '銀河', '惑星', '星間', '宇宙船']],
    ['近未来', ['近未来', '未来都市', '未来社会']],
    ['現代日本', ['現代日本', '東京', '日本の街', '現代社会']],
    ['歴史・時代劇', ['戦国', '江戸', '幕末', '平安', '明治', '大正', '時代劇']],
    ['終末・ディストピア', ['終末', '世界崩壊', '文明崩壊', 'ディストピア', '荒廃した世界']],
    ['職場', ['職場', '会社', 'オフィス', '仕事場']],
    ['田舎・地方', ['田舎', '地方都市', '離島', '村で暮ら']],
  ],
  theme: [
    ['友情・仲間', ['友情', '仲間', '絆']],
    ['成長・挑戦', ['成長', '挑戦', '夢を目指', '青春']],
    ['家族', ['家族', '親子', '兄弟', '姉妹']],
    ['恋愛', ['恋愛', '恋する', '恋心', 'ラブコメ', '婚約', '結婚']],
    ['音楽・アイドル', ['音楽', 'バンド', 'アイドル', 'ライブ活動', '歌手']],
    ['料理・グルメ', ['料理', 'グルメ', '食堂', 'レストラン', '菓子', '食べ歩き']],
    ['推理・謎解き', ['推理', '謎解き', '探偵', '事件を追', '真相']],
    ['政治・戦略', ['政治', '国家', '戦略', '軍略', '領土', '外交']],
    ['サバイバル', ['サバイバル', '生き残', 'デスゲーム', '極限状態']],
    ['職業・仕事', ['仕事', '職場', '会社員', '働く', '職人']],
    ['スポーツ', ['スポーツ', '大会', '全国大会', '選手権', '競技']],
    ['復讐', ['復讐', '仇討ち', '報復']],
    ['戦争', ['戦争', '戦場', '軍隊', '侵略']],
    ['癒やし', ['癒やし', 'ほのぼの', '穏やかな日々']],
    ['子育て', ['子育て', '育児', '赤ちゃん', '子どもを育て']],
    ['旅・冒険', ['旅', '冒険', '巡る', 'ロードムービー']],
    ['創作・芸能', ['漫画家', '小説家', '俳優', '声優', '映像制作', '創作活動']],
  ],
  motif: [
    ['魔法', ['魔法', '魔術', '魔導']],
    ['ロボット・メカ', ['ロボット', 'メカ', '機動兵器']],
    ['怪獣', ['怪獣', '巨大生物', '特撮ヒーロー']],
    ['怪異・妖怪', ['怪異', '妖怪', '幽霊', '鬼', '呪い']],
    ['犯罪・警察', ['警察', '刑事', '犯罪', '捜査', 'マフィア', 'ギャング']],
    ['医療', ['医療', '病院', '医師', '医者', '看護師']],
    ['ゲーム世界', ['ゲーム世界', 'VRMMO', 'オンラインゲーム', 'ゲーム内']],
    ['転生', ['転生', '生まれ変わ']],
    ['時間移動', ['タイムリープ', 'タイムマシン', '時間旅行', '過去へ']],
    ['超能力', ['超能力', '異能力', '特殊能力']],
    ['吸血鬼', ['吸血鬼', 'ヴァンパイア']],
    ['軍事', ['軍隊', '軍人', '兵器', 'ミリタリー']],
    ['人工知能', ['人工知能', 'AI', 'アンドロイド']],
    ['電脳・VR', ['電脳', '仮想現実', 'VR', 'サイバースペース']],
  ],
  subgenre: [
    ['異世界ファンタジー', ['異世界', '転生', '転移', '召喚']],
    ['ダークファンタジー', ['ダークファンタジー', '呪われた世界', '残酷な世界']],
    ['現代ファンタジー', ['現代', '魔法', '怪異']],
    ['スペースオペラ', ['宇宙', '銀河', '艦隊', '帝国']],
    ['ロボットSF', ['ロボット', '機動兵器', 'パイロット']],
    ['サイバーパンク', ['サイバーパンク', '電脳', '義体']],
    ['終末SF', ['終末', '文明崩壊', 'ディストピア']],
    ['時間SF', ['タイムリープ', 'タイムマシン', '時間旅行']],
    ['ラブコメ', ['ラブコメ', '恋愛コメディ']],
    ['ミステリー', ['推理', '探偵', '謎解き', '事件']],
    ['スポ根', ['スポ根', '全国大会', '強豪校']],
  ],
  format: [],
};

function normalize(value) {
  return String(value ?? '').normalize('NFKC')
    .replace(/\u00a0/g, ' ').replace(/[\t\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ').trim();
}

function unique(values) { return [...new Set(values.filter(Boolean))]; }
function normalizedLower(value) { return normalize(value).toLocaleLowerCase('ja'); }
function matchedTerms(text, terms) {
  const normalized = normalizedLower(text);
  return unique(terms.filter((term) => normalized.includes(normalizedLower(term))));
}
function scoreTerms(text, terms) {
  const matches = matchedTerms(text, terms);
  return { score: matches.length, matches };
}
function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function normalizeOfficialGenres(values) {
  const found = [];
  for (const rawValue of Array.isArray(values) ? values : []) {
    const value = normalize(rawValue);
    if (!value) continue;
    const matches = OFFICIAL_GENRES
      .map((genre) => ({ genre, index: value.indexOf(genre) }))
      .filter(({ index }) => index >= 0)
      .sort((left, right) => left.index - right.index || left.genre.localeCompare(right.genre, 'ja'));
    found.push(...matches.map(({ genre }) => genre));
  }
  return unique(found);
}

export function extractOriginalCredit(staffText) {
  const match = normalize(staffText).match(/(?:^|[／/])\s*(?:原作|原案)\s*[:：]\s*([^／/]+)/u);
  return match ? normalize(match[1]) : null;
}

export function inferSourceOrigin({ staffText = '', originalCredit = null } = {}) {
  const evidenceText = normalize(originalCredit || extractOriginalCredit(staffText) || staffText);
  if (!evidenceText) return { value: null, confidence: 'unknown', rule_id: 'origin.no-evidence', matched_terms: [] };

  for (const [terms, value, ruleId] of [
    [WEB_NOVEL_PLATFORMS, 'Web小説（なろう・カクヨム系）', 'origin.explicit-web-platform'],
    [VISUAL_NOVEL_SIGNALS, 'ビジュアルノベル', 'origin.explicit-visual-novel-credit'],
    [GAME_SIGNALS, 'ゲーム', 'origin.explicit-game-credit'],
    [MANGA_SIGNALS, '漫画', 'origin.publication-credit-manga'],
    [NOVEL_SIGNALS, 'ライトノベル・小説', 'origin.publication-credit-novel'],
    [ORIGINAL_SIGNALS, 'オリジナル', 'origin.explicit-original'],
  ]) {
    const matched = matchedTerms(evidenceText, terms);
    if (matched.length) return { value, confidence: 'verified', rule_id: ruleId, matched_terms: matched };
  }
  return { value: null, confidence: 'unknown', rule_id: 'origin.unclassified-credit', matched_terms: [] };
}

export function classifySpeculativeGenre({ title = '', synopsis = '' } = {}) {
  const text = `${title} ${synopsis}`;
  const sf = scoreTerms(text, SPECULATIVE_SIGNALS.sf);
  const fantasy = scoreTerms(text, SPECULATIVE_SIGNALS.fantasy);
  const highFantasyMatches = matchedTerms(text, HIGH_FANTASY_SIGNALS);
  const domains = [];
  if (sf.score > 0) domains.push('SF');
  if (fantasy.score > 0) domains.push('ファンタジー');

  let primary = null;
  let ruleId = 'genre.speculative-insufficient-evidence';
  let confidence = 'unknown';
  if (highFantasyMatches.length >= 1 && fantasy.score > 0) {
    primary = '異世界・ハイファンタジー';
    ruleId = 'genre.fantasy-plus-explicit-world-signal';
    confidence = 'derived';
  } else if (sf.score > fantasy.score && sf.score > 0) {
    primary = 'SF';
    ruleId = 'genre.sf-signal-dominant';
    confidence = 'derived';
  } else if (fantasy.score > sf.score && fantasy.score > 0) {
    primary = 'ファンタジー';
    ruleId = 'genre.fantasy-signal-dominant';
    confidence = 'derived';
  } else if (sf.score > 0 && fantasy.score > 0) {
    primary = 'クロスジャンル';
    ruleId = 'genre.sf-fantasy-balanced';
    confidence = 'derived';
  } else if (sf.score > 0) {
    primary = 'SF';
    ruleId = 'genre.sf-signal-only';
    confidence = 'derived';
  } else if (fantasy.score > 0) {
    primary = 'ファンタジー';
    ruleId = 'genre.fantasy-signal-only';
    confidence = 'derived';
  }

  return {
    primary, domains, confidence, rule_id: ruleId,
    matched_terms: { sf: sf.matches, fantasy: fantasy.matches, high_fantasy: highFantasyMatches },
  };
}

export function inferPrimaryGenre({ officialGenres = [], title = '', synopsis = '' } = {}) {
  const genres = normalizeOfficialGenres(officialGenres);
  if (!genres.length) return { value: null, confidence: 'unknown', rule_id: 'genre.no-official-genre', matched_terms: [] };
  if (genres.includes('SF/ファンタジー')) {
    const speculative = classifySpeculativeGenre({ title, synopsis });
    if (speculative.primary) {
      return {
        value: speculative.primary, confidence: speculative.confidence,
        rule_id: speculative.rule_id, matched_terms: unique(Object.values(speculative.matched_terms).flat()),
        domains: speculative.domains,
      };
    }
  }
  const firstNonSpeculative = genres.find((genre) => genre !== 'SF/ファンタジー');
  if (firstNonSpeculative) {
    return {
      value: OFFICIAL_CANONICAL_MAP.get(firstNonSpeculative) ?? null,
      confidence: 'verified', rule_id: 'genre.first-official-non-speculative', matched_terms: [], domains: [],
    };
  }
  return {
    value: 'スペキュレーティブ判定保留', confidence: 'unknown',
    rule_id: 'genre.speculative-official-bucket-without-leaf-evidence', matched_terms: [], domains: [],
  };
}

function inferRules(text, rules) {
  const values = [];
  const evidence = {};
  for (const [tag, terms] of rules) {
    const found = matchedTerms(text, terms);
    if (!found.length) continue;
    values.push(tag);
    evidence[tag] = found;
  }
  return { values: unique(values), evidence };
}

function canonicalOfficialGenres(officialGenres, speculativeDomains) {
  const values = [];
  for (const genre of normalizeOfficialGenres(officialGenres)) {
    if (genre === 'SF/ファンタジー') values.push(...speculativeDomains);
    else values.push(OFFICIAL_CANONICAL_MAP.get(genre));
  }
  return unique(values);
}

function deriveOntology({ officialGenres = [], title = '', synopsis = '', sourceOrigin = null, primaryGenre = null } = {}) {
  const text = `${title} ${synopsis}`;
  const speculative = classifySpeculativeGenre({ title, synopsis });
  const canonicalOfficial = canonicalOfficialGenres(officialGenres, speculative.domains);
  const evidence = {};
  const inferred = {};
  for (const facet of ['setting', 'theme', 'motif', 'subgenre']) {
    const result = inferRules(text, FACET_RULES[facet]);
    inferred[facet] = result.values;
    evidence[facet] = result.evidence;
  }
  const formatTags = canonicalOfficial.filter((tag) => [
    'ショート', '2.5次元舞台', 'ライブ・ラジオ・その他',
  ].includes(tag));
  const hasOfficialSpeculativeBucket = normalizeOfficialGenres(officialGenres).includes('SF/ファンタジー');
  const genreTags = unique([
    primaryGenre || null,
    ...speculative.domains,
    ...canonicalOfficial,
    hasOfficialSpeculativeBucket && speculative.domains.length === 0 ? 'スペキュレーティブ判定保留' : null,
  ]);
  const subgenre = unique([
    primaryGenre === '異世界・ハイファンタジー' ? '異世界ファンタジー' : null,
    ...inferred.subgenre,
  ]);
  const facets = {
    source: sourceOrigin ? [sourceOrigin] : [],
    genre: genreTags,
    subgenre,
    setting: inferred.setting,
    theme: inferred.theme,
    motif: unique([
      ...inferred.motif,
      ...canonicalOfficial.filter((tag) => tag === 'ロボット・メカ'),
    ]),
    format: formatTags,
  };
  return { facets, evidence, speculative };
}

export function inferOntologyFacets(input = {}) {
  return deriveOntology(input).facets;
}

export function inferCanonicalTags({
  officialGenres = [], primaryGenre = null, title = '', synopsis = '', sourceOrigin = null,
} = {}) {
  const { facets } = deriveOntology({ officialGenres, primaryGenre, title, synopsis, sourceOrigin });
  return unique([
    ...facets.genre,
    ...facets.subgenre,
    ...facets.setting,
    ...facets.theme,
    ...facets.motif,
    ...facets.format,
  ]);
}

export function parseOfficialDetailText(bodyText) {
  const lines = String(bodyText ?? '').normalize('NFKC').split(/\r?\n/u)
    .map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const synopsisStart = lines.findIndex((line) => /あらすじ\s*[／/]\s*ジャンル/u.test(line));
  const synopsisEnd = synopsisStart >= 0
    ? lines.findIndex((line, index) => index > synopsisStart && /^(?:シリーズ[／/]関連|キャスト\s*[／/]\s*スタッフ)/u.test(line))
    : -1;
  const section = synopsisStart >= 0 ? lines.slice(synopsisStart + 1, synopsisEnd >= 0 ? synopsisEnd : undefined) : [];
  const officialGenres = normalizeOfficialGenres(section);
  const firstGenreLine = section.findIndex((line) => normalizeOfficialGenres([line]).length > 0);
  const synopsis = normalize((firstGenreLine >= 0 ? section.slice(0, firstGenreLine) : section).join(' '));
  const staffStart = lines.findIndex((line) => /^\[スタッフ\]$/u.test(line));
  const yearStart = lines.findIndex((line, index) => index > staffStart && /^\[製作年\]$/u.test(line));
  const staffText = staffStart >= 0
    ? normalize(lines.slice(staffStart + 1, yearStart >= 0 ? yearStart : undefined).join('／')) : '';
  const yearMatch = yearStart >= 0
    ? lines.slice(yearStart + 1, yearStart + 4).join(' ').match(/((?:19|20)\d{2})年/u) : null;
  const titleLine = lines.find((line) => /（全\d+話）$/u.test(line)) ?? '';
  return {
    title: normalize(titleLine.replace(/（全\d+話）$/u, '')),
    officialGenres, synopsis, staffText,
    productionYear: yearMatch ? Number(yearMatch[1]) : null,
  };
}

function shortEvidence(value, maxLength = 240) {
  const text = normalize(value);
  if (!text) return null;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function normalizedProductionYear(value) {
  return value !== null && value !== undefined && value !== '' && Number.isInteger(Number(value))
    ? Number(value) : null;
}

function snapshotFromInput({ title, synopsis, staffText, officialGenres, productionYear, snapshotSource }) {
  const payload = {
    title: normalize(title), synopsis: normalize(synopsis), staff_text: normalize(staffText),
    official_genres: normalizeOfficialGenres(officialGenres),
    production_year: normalizedProductionYear(productionYear),
  };
  return { ...payload, source: snapshotSource, sha256: stableHash(payload) };
}

export function buildAttributeRecord({
  workId, title = '', detailUrl, officialGenres = [], synopsis = '',
  staffText = '', productionYear = null, fetchedAt = new Date().toISOString(),
  cacheStatus = 'network-fetched', snapshotSource = 'network',
} = {}) {
  if (!workId) throw new Error('workId is required');
  if (!detailUrl) throw new Error('detailUrl is required');
  const snapshot = snapshotFromInput({ title, synopsis, staffText, officialGenres, productionYear, snapshotSource });
  const genres = snapshot.official_genres;
  const originalCredit = extractOriginalCredit(snapshot.staff_text);
  const origin = inferSourceOrigin({ staffText: snapshot.staff_text, originalCredit });
  const primary = inferPrimaryGenre({ officialGenres: genres, title: snapshot.title, synopsis: snapshot.synopsis });
  const ontology = deriveOntology({
    officialGenres: genres, title: snapshot.title, synopsis: snapshot.synopsis,
    sourceOrigin: origin.value, primaryGenre: primary.value,
  });
  const tags = inferCanonicalTags({
    officialGenres: genres, primaryGenre: primary.value, title: snapshot.title,
    synopsis: snapshot.synopsis, sourceOrigin: origin.value,
  });
  const hasDerivedOntology = Object.entries(ontology.facets)
    .filter(([facet]) => !['source', 'genre'].includes(facet))
    .some(([, values]) => values.length > 0);
  const hasOfficialSpeculativeBucket = genres.includes('SF/ファンタジー');
  const speculativeNeedsReview = hasOfficialSpeculativeBucket && ontology.speculative.domains.length === 0;
  return {
    schema_version: ATTRIBUTE_SCHEMA_VERSION,
    ontology_version: ONTOLOGY_VERSION,
    work_id: String(workId),
    attribute_source_url: detailUrl,
    attribute_fetched_at: fetchedAt,
    cache_status: cacheStatus,
    official_snapshot: snapshot,
    official_genres: genres,
    production_year: snapshot.production_year,
    original_credit: originalCredit,
    source_origin: origin.value,
    primary_genre: primary.value,
    speculative_genres: ontology.speculative.domains,
    speculative_genre_status: hasOfficialSpeculativeBucket
      ? (speculativeNeedsReview ? 'needs-review' : 'classified')
      : 'not-applicable',
    canonical_tags: tags.length ? tags : ['分類保留'],
    ontology_facets: ontology.facets,
    classification_status: primary.value === 'スペキュレーティブ判定保留' || speculativeNeedsReview
      ? 'needs-review' : 'classified',
    attribute_confidence: {
      source_origin: origin.confidence,
      primary_genre: primary.confidence,
      canonical_tags: hasDerivedOntology ? 'derived' : (genres.length ? 'verified' : 'unknown'),
      ontology_facets: hasDerivedOntology ? 'derived' : (genres.length ? 'verified' : 'unknown'),
    },
    attribute_evidence: {
      source_origin: {
        rule_id: origin.rule_id, matched_terms: origin.matched_terms,
        evidence_text: shortEvidence(originalCredit), source_url: detailUrl,
      },
      primary_genre: {
        rule_id: primary.rule_id, official_genres: genres,
        matched_terms: primary.matched_terms, source_url: detailUrl,
      },
      canonical_tags: {
        rule_id: 'tags.official-plus-ontology-v2', official_genres: genres, source_url: detailUrl,
      },
      ontology_facets: {
        rule_id: 'ontology.keyword-plus-official-metadata-v2',
        matched_terms: ontology.evidence, source_url: detailUrl,
      },
    },
  };
}

function flattenLegacyMatchedTerms(record) {
  const matched = record?.attribute_evidence?.ontology_facets?.matched_terms;
  if (!matched || typeof matched !== 'object') return [];
  const values = [];
  for (const facetValue of Object.values(matched)) {
    if (!facetValue || typeof facetValue !== 'object') continue;
    for (const terms of Object.values(facetValue)) {
      if (Array.isArray(terms)) values.push(...terms);
    }
  }
  const primaryTerms = record?.attribute_evidence?.primary_genre?.matched_terms;
  if (Array.isArray(primaryTerms)) values.push(...primaryTerms);
  return unique(values.map(normalize));
}

export function rebuildAttributeRecordFromCache(record, { title = '' } = {}) {
  if (!record?.work_id || !record?.attribute_source_url) throw new Error('Invalid cached attribute record');
  const snapshot = record.official_snapshot;
  if (snapshot?.official_genres?.length) {
    return buildAttributeRecord({
      workId: record.work_id,
      title: snapshot.title || title,
      detailUrl: record.attribute_source_url,
      officialGenres: snapshot.official_genres,
      synopsis: snapshot.synopsis || '',
      staffText: snapshot.staff_text || '',
      productionYear: snapshot.production_year,
      fetchedAt: record.attribute_fetched_at,
      cacheStatus: 'full-snapshot-reused',
      snapshotSource: snapshot.source || 'network',
    });
  }
  const legacyText = unique([
    title,
    record.original_credit,
    ...(Array.isArray(record.canonical_tags) ? record.canonical_tags : []),
    ...flattenLegacyMatchedTerms(record),
  ]).join(' ');
  return buildAttributeRecord({
    workId: record.work_id,
    title,
    detailUrl: record.attribute_source_url,
    officialGenres: record.official_genres,
    synopsis: legacyText,
    staffText: record.original_credit ? `原作:${record.original_credit}` : '',
    productionYear: record.production_year,
    fetchedAt: record.attribute_fetched_at,
    cacheStatus: 'legacy-cache-reused',
    snapshotSource: 'legacy-derived',
  });
}
