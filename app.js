const elements = {
  totalWorks: document.querySelector('#totalWorks'),
  yearCount: document.querySelector('#yearCount'),
  generatedAt: document.querySelector('#generatedAt'),
  visibleCount: document.querySelector('#visibleCount'),
  yearSelect: document.querySelector('#yearSelect'),
  searchInput: document.querySelector('#searchInput'),
  sortSelect: document.querySelector('#sortSelect'),
  preferenceToggle: document.querySelector('#preferenceToggle'),
  metadataNotice: document.querySelector('#metadataNotice'),
  yearKicker: document.querySelector('#yearKicker'),
  yearTitle: document.querySelector('#yearTitle'),
  resultSummary: document.querySelector('#resultSummary'),
  sourceLink: document.querySelector('#sourceLink'),
  loadingState: document.querySelector('#loadingState'),
  errorState: document.querySelector('#errorState'),
  emptyState: document.querySelector('#emptyState'),
  workGrid: document.querySelector('#workGrid'),
  cardTemplate: document.querySelector('#workCardTemplate'),
};

const preferenceProfile = {
  origin: 'Web小説（なろう・カクヨム系）',
  genre: '異世界・ハイファンタジー',
  tag: 'バトル・アクション',
};

const metadataKeys = {
  origin: ['source_origin', 'origin_root', 'original_source', '原作ルーツ'],
  genre: ['primary_genre', 'main_genre', 'genre', '主ジャンル'],
  tags: ['canonical_tags', 'normalized_tags', 'tags', '正規タグ'],
};

const state = {
  manifest: null,
  works: [],
  currentYear: null,
  metadataAvailable: false,
  favoritesAvailableCount: 0,
};

function formatNumber(value) {
  return new Intl.NumberFormat('ja-JP').format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function normalizeTitle(value) {
  return String(value || 'タイトル不明').replace(/_2$/, '').trim();
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('ja');
}

function normalizeLookupTitle(value) {
  return normalizeText(normalizeTitle(value)).replace(/\s+/g, ' ');
}

function firstValue(record, keys) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== '') {
      return record[key];
    }
  }
  return null;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return String(value)
    .split(/[、,|/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasPreferenceMetadata(work) {
  return Boolean(
    firstValue(work, metadataKeys.origin)
    || firstValue(work, metadataKeys.genre)
    || firstValue(work, metadataKeys.tags),
  );
}

function matchesPreferenceExclusion(work) {
  const origin = normalizeText(firstValue(work, metadataKeys.origin));
  const genre = normalizeText(firstValue(work, metadataKeys.genre));
  const tags = toArray(firstValue(work, metadataKeys.tags)).map(normalizeText);

  return origin === normalizeText(preferenceProfile.origin)
    || genre === normalizeText(preferenceProfile.genre)
    || tags.includes(normalizeText(preferenceProfile.tag));
}

function hasFavoritesCount(work) {
  return work.favorites_count !== null
    && work.favorites_count !== undefined
    && work.favorites_count !== ''
    && Number.isFinite(Number(work.favorites_count));
}

function ensureFavoritesSortOptions() {
  if (elements.sortSelect.querySelector('option[value="favorites-desc"]')) return;

  const descending = new Option('気になる登録数 多い順', 'favorites-desc');
  const ascending = new Option('気になる登録数 少ない順', 'favorites-asc');
  elements.sortSelect.prepend(ascending);
  elements.sortSelect.prepend(descending);
}

function setBusy(isBusy) {
  elements.loadingState.hidden = !isBusy;
  elements.yearSelect.disabled = isBusy;
  elements.sortSelect.disabled = isBusy;
}

function setError(message = '') {
  elements.errorState.textContent = message;
  elements.errorState.hidden = !message;
}

function syncUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('year', String(state.currentYear));

  const query = elements.searchInput.value.trim();
  if (query) url.searchParams.set('q', query);
  else url.searchParams.delete('q');

  const sort = elements.sortSelect.value;
  if (sort && sort !== 'favorites-desc') url.searchParams.set('sort', sort);
  else url.searchParams.delete('sort');

  history.replaceState(null, '', url);
}

function renderMetadataNotice() {
  const favoritesNote = state.favoritesAvailableCount
    ? ` 気になる登録数は${formatNumber(state.favoritesAvailableCount)}作品で利用できます。`
    : ' この年度には気になる登録数データがありません。';

  if (state.metadataAvailable) {
    elements.preferenceToggle.disabled = false;
    elements.metadataNotice.textContent = `属性データを検出しました。除外条件は「いずれかに一致」で適用されます。${favoritesNote}`;
    return;
  }

  elements.preferenceToggle.disabled = true;
  elements.metadataNotice.textContent = `現在の取得データには原作ルーツ・主ジャンル・正規タグが未収録のため、嗜好除外は保留しています。作品名だけから推定除外はしません。${favoritesNote}`;
}

function compareFavorites(a, b, direction) {
  const aKnown = hasFavoritesCount(a);
  const bKnown = hasFavoritesCount(b);
  if (aKnown !== bKnown) return aKnown ? -1 : 1;
  if (!aKnown) return 0;

  const difference = Number(a.favorites_count) - Number(b.favorites_count);
  if (difference !== 0) return difference * direction;
  return normalizeTitle(a.title).localeCompare(normalizeTitle(b.title), 'ja');
}

function sortedWorks(works) {
  const mode = elements.sortSelect.value;
  if (mode === 'official') return works;

  if (mode === 'favorites-desc') {
    return [...works].sort((a, b) => compareFavorites(a, b, -1));
  }
  if (mode === 'favorites-asc') {
    return [...works].sort((a, b) => compareFavorites(a, b, 1));
  }

  const direction = mode === 'title-desc' ? -1 : 1;
  return [...works].sort((a, b) => (
    normalizeTitle(a.title).localeCompare(normalizeTitle(b.title), 'ja') * direction
  ));
}

function filteredWorks() {
  const query = normalizeText(elements.searchInput.value);
  const applyPreference = elements.preferenceToggle.checked && state.metadataAvailable;

  return state.works.filter((work) => {
    const matchesSearch = !query || normalizeText(normalizeTitle(work.title)).includes(query);
    const excluded = applyPreference && matchesPreferenceExclusion(work);
    return matchesSearch && !excluded;
  });
}

function buildFavoritesRanks() {
  const ranked = state.works
    .filter(hasFavoritesCount)
    .sort((a, b) => compareFavorites(a, b, -1));

  const ranks = new Map();
  let previousCount = null;
  let currentRank = 0;

  ranked.forEach((work, index) => {
    const count = Number(work.favorites_count);
    if (count !== previousCount) currentRank = index + 1;
    ranks.set(work.work_id || normalizeLookupTitle(work.title), currentRank);
    previousCount = count;
  });

  return ranks;
}

function renderWorks() {
  const filtered = filteredWorks();
  const sorted = sortedWorks(filtered);
  const favoritesRanks = buildFavoritesRanks();
  const excludedCount = state.metadataAvailable && elements.preferenceToggle.checked
    ? state.works.filter(matchesPreferenceExclusion).length
    : 0;

  elements.workGrid.replaceChildren();
  elements.emptyState.hidden = sorted.length !== 0;
  elements.visibleCount.textContent = formatNumber(sorted.length);
  elements.resultSummary.textContent = [
    `${formatNumber(sorted.length)} / ${formatNumber(state.works.length)}件表示`,
    `登録数データ ${formatNumber(state.favoritesAvailableCount)}件`,
    excludedCount ? `嗜好除外 ${formatNumber(excludedCount)}件` : '',
  ].filter(Boolean).join('・');

  const fragment = document.createDocumentFragment();
  for (const work of sorted) {
    const card = elements.cardTemplate.content.cloneNode(true);
    const link = card.querySelector('.work-card__link');
    const image = card.querySelector('.work-card__image');
    const title = normalizeTitle(work.title);
    const rankKey = work.work_id || normalizeLookupTitle(title);
    const rank = favoritesRanks.get(rankKey);
    const favoritesText = hasFavoritesCount(work)
      ? `#${rank} · 気になる登録 ${formatNumber(work.favorites_count)}件`
      : '気になる登録数 不明';

    link.href = work.detail_url || work.source_tag_url || '#';
    link.setAttribute('aria-label', `${title}を公式ページで確認`);
    image.src = work.image_url || '';
    image.alt = `${title}の作品画像`;
    image.addEventListener('error', () => image.remove(), { once: true });

    card.querySelector('.work-card__year').textContent = `${work.year || state.currentYear}年`;
    card.querySelector('.work-card__title').textContent = title;
    card.querySelector('.work-card__meta').textContent = `${favoritesText} · 作品ID ${work.work_id || '—'} · 公式ページ ↗`;
    fragment.append(card);
  }
  elements.workGrid.append(fragment);
  syncUrl();
}

async function loadFavoritesMap(year) {
  try {
    const response = await fetch(`./data/likes/${year}.tsv`, { cache: 'no-cache' });
    if (!response.ok) return new Map();

    const text = await response.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return new Map();

    const map = new Map();
    for (const line of lines.slice(1)) {
      const separatorIndex = line.lastIndexOf('\t');
      if (separatorIndex < 1) continue;
      const title = line.slice(0, separatorIndex);
      const count = Number(line.slice(separatorIndex + 1));
      if (!Number.isFinite(count)) continue;
      map.set(normalizeLookupTitle(title), count);
    }
    return map;
  } catch {
    return new Map();
  }
}

async function loadYear(year) {
  state.currentYear = Number(year);
  setBusy(true);
  setError();
  elements.workGrid.replaceChildren();
  elements.emptyState.hidden = true;
  elements.yearKicker.textContent = `${state.currentYear} YEAR CATALOGUE`;
  elements.yearTitle.textContent = `${state.currentYear}年のアニメ`;

  try {
    const response = await fetch(`./data/by-year/${state.currentYear}.json`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const favoritesMap = await loadFavoritesMap(state.currentYear);
    const officialWorks = Array.isArray(payload.works) ? payload.works : [];

    state.works = officialWorks.map((work) => {
      const count = favoritesMap.get(normalizeLookupTitle(work.title));
      return {
        ...work,
        favorites_count: Number.isFinite(count) ? count : null,
      };
    });
    state.favoritesAvailableCount = state.works.filter(hasFavoritesCount).length;
    state.metadataAvailable = state.works.some(hasPreferenceMetadata);
    elements.sourceLink.href = payload.source_url || state.manifest?.source?.tag_selector_url || '#';
    renderMetadataNotice();
    renderWorks();
  } catch (error) {
    state.works = [];
    state.favoritesAvailableCount = 0;
    elements.visibleCount.textContent = '0';
    elements.resultSummary.textContent = '';
    setError(`${state.currentYear}年の作品データを読み込めませんでした。${error instanceof Error ? ` (${error.message})` : ''}`);
  } finally {
    setBusy(false);
  }
}

function populateYears(years) {
  const ordered = [...years].sort((a, b) => b - a);
  elements.yearSelect.replaceChildren(...ordered.map((year) => {
    const option = document.createElement('option');
    option.value = String(year);
    option.textContent = `${year}年`;
    return option;
  }));
}

async function initialize() {
  ensureFavoritesSortOptions();
  setBusy(true);
  setError();

  try {
    const response = await fetch('./data/manifest.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.manifest = await response.json();

    const years = Array.isArray(state.manifest.discovered_years)
      ? state.manifest.discovered_years.map(Number).filter(Number.isFinite)
      : [];
    if (!years.length) throw new Error('年度一覧が空です');

    elements.totalWorks.textContent = formatNumber(state.manifest.canonical_work_count);
    elements.yearCount.textContent = formatNumber(state.manifest.year_count || years.length);
    elements.generatedAt.textContent = formatDate(state.manifest.generated_at);
    populateYears(years);

    const params = new URLSearchParams(window.location.search);
    const requestedYear = Number(params.get('year'));
    const defaultYear = years.includes(requestedYear)
      ? requestedYear
      : (years.includes(2024) ? 2024 : Math.max(...years));
    const requestedSort = params.get('sort');
    const validSort = requestedSort && elements.sortSelect.querySelector(`option[value="${CSS.escape(requestedSort)}"]`);

    elements.searchInput.value = params.get('q') || '';
    elements.sortSelect.value = validSort ? requestedSort : 'favorites-desc';
    elements.yearSelect.value = String(defaultYear);
    await loadYear(defaultYear);
  } catch (error) {
    setError(`カタログ情報を読み込めませんでした。${error instanceof Error ? ` (${error.message})` : ''}`);
    setBusy(false);
  }
}

elements.yearSelect.addEventListener('change', (event) => loadYear(event.target.value));
elements.searchInput.addEventListener('input', renderWorks);
elements.sortSelect.addEventListener('change', renderWorks);
elements.preferenceToggle.addEventListener('change', renderWorks);

initialize();
