const OFFICIAL_GENRE_MAP = new Map([
  ['SF/ファンタジー', 'SF・ファンタジー'],
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

export const OFFICIAL_GENRES = [...OFFICIAL_GENRE_MAP.keys()];

const WEB_NOVEL_PLATFORMS = [
  '小説家になろう',
  'カクヨム',
  'アルファポリス',
  'エブリスタ',
  'ノベルアップ+',
  'ノベルアップ＋',
  '魔法のiらんど',
  'pixiv',
  'Arcadia',
  'ハーメルン',
];

const MANGA_SIGNALS = [
  'コミックス', 'コミック', '漫画', '少年ジャンプ', 'ヤングジャンプ',
  '週刊少年', '月刊少年', 'マーガレット', '花とゆめ', 'モーニング',
  'アフタヌーン', 'ビッグコミック', 'ガンガン', 'サンデー', 'マガジン',
  'チャンピオン', 'ヤングマガジン',
];

const NOVEL_SIGNALS = [
  '文庫', 'ノベル', '小説', 'ブックス', 'BOOKS',
];

const GAME_SIGNALS = [
  'ゲーム', 'スマートフォンゲーム', 'アプリゲーム', 'ブラウザゲーム',
];

const HIGH_FANTASY_SIGNALS = [
  '異世界', '転生', '転移', '召喚', '勇者', '魔王', '冒険者', 'ダンジョン',
  'ギルド', '剣と魔法', '魔法', '魔術', '精霊', 'エルフ', 'ドラゴン', '竜族',
  '聖女', '賢者',
];

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function matchedTerms(text, terms) {
  const normalized = normalize(text).toLocaleLowerCase('ja');
  return unique(terms.filter((term) => normalized.includes(normalize(term).toLocaleLowerCase('ja'))));
}

export function normalizeOfficialGenres(values) {
  return unique((Array.isArray(values) ? values : [])
    .map(normalize)
    .filter((value) => OFFICIAL_GENRE_MAP.has(value)));
}

export function extractOriginalCredit(staffText) {
  const text = normalize(staffText);
  const match = text.match(/(?:^|[／/])\s*(?:原作|原案)\s*[:：]\s*([^／/]+)/u);
  return match ? normalize(match[1]) : null;
}

export function inferSourceOrigin({ staffText = '', originalCredit = null } = {}) {
  const evidenceText = normalize(originalCredit || extractOriginalCredit(staffText) || staffText);
  if (!evidenceText) {
    return { value: null, confidence: 'unknown', rule_id: 'origin.no-evidence', matched_terms: [] };
  }

  const webTerms = matchedTerms(evidenceText, WEB_NOVEL_PLATFORMS);
  if (webTerms.length) {
    return {
      value: 'Web小説（なろう・カクヨム系）',
      confidence: 'verified',
      rule_id: 'origin.explicit-web-platform',
      matched_terms: webTerms,
    };
  }

  const gameTerms = matchedTerms(evidenceText, GAME_SIGNALS);
  if (gameTerms.length) {
    return {
      value: 'ゲーム',
      confidence: 'verified',
      rule_id: 'origin.explicit-game-credit',
      matched_terms: gameTerms,
    };
  }

  const mangaTerms = matchedTerms(evidenceText, MANGA_SIGNALS);
  if (mangaTerms.length) {
    return {
      value: '漫画',
      confidence: 'verified',
      rule_id: 'origin.publication-credit-manga',
      matched_terms: mangaTerms,
    };
  }

  const novelTerms = matchedTerms(evidenceText, NOVEL_SIGNALS);
  if (novelTerms.length) {
    return {
      value: 'ライトノベル・小説',
      confidence: 'verified',
      rule_id: 'origin.publication-credit-novel',
      matched_terms: novelTerms,
    };
  }

  return {
    value: null,
    confidence: 'unknown',
    rule_id: 'origin.unclassified-credit',
    matched_terms: [],
  };
}

export function inferPrimaryGenre({ officialGenres = [], title = '', synopsis = '' } = {}) {
  const genres = normalizeOfficialGenres(officialGenres);
  if (!genres.length) {
    return { value: null, confidence: 'unknown', rule_id: 'genre.no-official-genre', matched_terms: [] };
  }

  if (genres.includes('SF/ファンタジー')) {
    const fantasyTerms = matchedTerms(`${title} ${synopsis}`, HIGH_FANTASY_SIGNALS);
    if (fantasyTerms.length) {
      return {
        value: '異世界・ハイファンタジー',
        confidence: 'derived',
        rule_id: 'genre.official-fantasy-plus-explicit-world-signal',
        matched_terms: fantasyTerms,
      };
    }
  }

  return {
    value: OFFICIAL_GENRE_MAP.get(genres[0]) ?? null,
    confidence: 'verified',
    rule_id: 'genre.first-official-genre',
    matched_terms: [],
  };
}

export function inferCanonicalTags({ officialGenres = [], primaryGenre = null } = {}) {
  const tags = normalizeOfficialGenres(officialGenres)
    .map((genre) => OFFICIAL_GENRE_MAP.get(genre));
  if (primaryGenre === '異世界・ハイファンタジー') tags.unshift(primaryGenre);
  return unique(tags);
}

export function parseOfficialDetailText(bodyText, anchorLabels = []) {
  const lines = String(bodyText ?? '')
    .normalize('NFKC')
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const synopsisStart = lines.findIndex((line) => /あらすじ\s*[／/]\s*ジャンル/u.test(line));
  const synopsisEnd = synopsisStart >= 0
    ? lines.findIndex((line, index) => index > synopsisStart && /^(?:シリーズ[／/]関連|キャスト\s*[／/]\s*スタッフ)/u.test(line))
    : -1;
  const synopsisSection = synopsisStart >= 0
    ? lines.slice(synopsisStart + 1, synopsisEnd >= 0 ? synopsisEnd : undefined)
    : [];

  const genreCandidates = [
    ...(Array.isArray(anchorLabels) ? anchorLabels : []),
    ...synopsisSection,
  ];
  const officialGenres = normalizeOfficialGenres(genreCandidates);
  const firstGenreIndex = synopsisSection.findIndex((line) => OFFICIAL_GENRE_MAP.has(line));
  const synopsisLines = firstGenreIndex >= 0
    ? synopsisSection.slice(0, firstGenreIndex)
    : synopsisSection;
  const synopsis = normalize(synopsisLines.join(' '));

  const staffStart = lines.findIndex((line) => /^\[スタッフ\]$/u.test(line));
  const yearStart = lines.findIndex((line, index) => index > staffStart && /^\[製作年\]$/u.test(line));
  const staffText = staffStart >= 0
    ? normalize(lines.slice(staffStart + 1, yearStart >= 0 ? yearStart : undefined).join('／'))
    : '';

  let productionYear = null;
  if (yearStart >= 0) {
    const match = lines.slice(yearStart + 1, yearStart + 4).join(' ').match(/((?:19|20)\d{2})年/u);
    if (match) productionYear = Number(match[1]);
  }

  const titleLine = lines.find((line) => /（全\d+話）$/u.test(line)) ?? '';
  const title = normalize(titleLine.replace(/（全\d+話）$/u, ''));

  return { title, officialGenres, synopsis, staffText, productionYear };
}

function shortEvidence(value, maxLength = 240) {
  const text = normalize(value);
  if (!text) return null;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

export function buildAttributeRecord({
  workId,
  title = '',
  detailUrl,
  officialGenres = [],
  synopsis = '',
  staffText = '',
  productionYear = null,
  fetchedAt = new Date().toISOString(),
} = {}) {
  if (!workId) throw new Error('workId is required');
  if (!detailUrl) throw new Error('detailUrl is required');

  const genres = normalizeOfficialGenres(officialGenres);
  const originalCredit = extractOriginalCredit(staffText);
  const origin = inferSourceOrigin({ staffText, originalCredit });
  const primary = inferPrimaryGenre({ officialGenres: genres, title, synopsis });
  const tags = inferCanonicalTags({ officialGenres: genres, primaryGenre: primary.value });

  return {
    schema_version: '1.0.0',
    work_id: String(workId),
    attribute_source_url: detailUrl,
    attribute_fetched_at: fetchedAt,
    official_genres: genres,
    production_year: Number.isInteger(Number(productionYear)) ? Number(productionYear) : null,
    original_credit: originalCredit,
    source_origin: origin.value,
    primary_genre: primary.value,
    canonical_tags: tags,
    attribute_confidence: {
      source_origin: origin.confidence,
      primary_genre: primary.confidence,
      canonical_tags: genres.length ? 'verified' : 'unknown',
    },
    attribute_evidence: {
      source_origin: {
        rule_id: origin.rule_id,
        matched_terms: origin.matched_terms,
        evidence_text: shortEvidence(originalCredit),
        source_url: detailUrl,
      },
      primary_genre: {
        rule_id: primary.rule_id,
        official_genres: genres,
        matched_terms: primary.matched_terms,
        source_url: detailUrl,
      },
      canonical_tags: {
        rule_id: 'tags.official-genre-normalization',
        official_genres: genres,
        source_url: detailUrl,
      },
    },
  };
}
