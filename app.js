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
  recommendationSection: document.querySelector('#recommendations'),
  recommendationGrid: document.querySelector('#recommendationGrid'),
  recommendationStatus: document.querySelector('#recommendationStatus'),
  historySummary: document.querySelector('#historySummary'),
  resetHistoryButton: document.querySelector('#resetHistoryButton'),
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

const STORAGE_KEY = 'kafka2306-anime-click-history-v1';
const HISTORY_LIMIT = 100;
const RECOMMENDATION_LIMIT = 6;

const preferenceProfile = {
  origin: 'Web小説（なろう・カクヨム系）',
  genre: '異世界・ハイファンタジー',
  tag: 'バトル・アクション',
};

const metadataKeys = {
  origin: ['source_origin', 'origin_root', 'original_source', '原作ルーツ'],
  genre: ['primary_genre', 'main_genre', 'genre', '主ジャンル'],
  tags: ['canonical_tags', 'normalized_tags', 'tags', '正規タグ'],
  facets: ['ontology_facets'],
};

const state = {
  manifest: null,
  works: [],
  currentYear: null,
  metadataAvailable: false,
  favoritesAvailableCount: 0,
  favoritesSource: 'none',
  clickHistory: loadClickHistory(),
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
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === null || value === undefined || value === '') return [];
  return String(value)
    .split(/[、,|/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function ontologyFacetValues(work) {
  const facets = firstValue(work, metadataKeys.facets);
  if (!facets || typeof facets !== 'object' || Array.isArray(facets)) return [];
  return Object.entries(facets)
    .filter(([facet]) => facet !== 'source')
    .flatMap(([, values]) => toArray(values));
}

function workTags(work, limit = Number.POSITIVE_INFINITY) {
  const origin = firstValue(work, metadataKeys.origin);
  const primaryGenre = firstValue(work, metadataKeys.genre);
  const canonicalTags = toArray(firstValue(work, metadataKeys.tags));
  const facetTags = ontologyFacetValues(work);
  return unique([
    origin ? `原作:${origin}` : null,
    primaryGenre,
    ...canonicalTags,
    ...facetTags,
  ]).slice(0, limit);
}

function hasPreferenceMetadata(work) {
  return Boolean(
    firstValue(work, metadataKeys.origin)
    || firstValue(work, metadataKeys.genre)
    || firstValue(work, metadataKeys.tags)
    || ontologyFacetValues(work).length,
  );
}

function matchesPreferenceExclusion(work) {
  const origin = normalizeText(firstValue(work, metadataKeys.origin));
  const genre = normalizeText(firstValue(work, metadataKeys.genre));
  const tags = unique([
    ...toArray(firstValue(work, metadataKeys.tags)),
    ...ontologyFacetValues(work),
  ]).map(normalizeText);

  return origin === normalizeText(preferenceProfile.origin)
    || genre === normalizeText(preferenceProfile.genre)
    || tags.includes(normalizeText(preferenceProfile.tag));
}

function hasFavoritesCount(work) {
  return work.favorite_count !== null
    && work.favorite_count !== undefined
    && work.favorite_count !== ''
    && Number.isFinite(Number(work.favorite_count));
}

function ensureFavoritesSortOptions() {
  if (elements.sortSelect.querySelector('option[value="favorites-desc"]')) return;
  elements.sortSelect.prepend(
    new Option('気になる登録数 少ない順', 'favorites-asc'),
  );
  elements.sortSelect.prepend(
    new Option('気になる登録数 多い順', 'favorites-desc'),
  );
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
  const countSource = state.favoritesSource === 'official-json'
    ? '公式JSONの気になる登録数'
    : state.favoritesSource === 'legacy-tsv'
      ? '互換TSVの気になる登録数'
      : '気になる登録数';
  const favoritesNote = state.favoritesAvailableCount
    ? ` ${countSource}を${formatNumber(state.favoritesAvailableCount)}作品で利用できます。`
    : ' この年度には気になる登録数データがありません。';

  if (state.metadataAvailable) {
    elements.preferenceToggle.disabled = false;
    elements.metadataNotice.textContent = `属性オントロジーを検出しました。除外条件は「いずれかに一致」で適用されます。${favoritesNote}`;
    return;
  }

  elements.preferenceToggle.disabled = true;
  elements.metadataNotice.textContent = `現在の取得データには属性オントロジーが未収録のため、嗜好除外は保留しています。作品名だけから推定除外はしません。${favoritesNote}`;
}

function compareFavorites(a, b, direction) {
  const aKnown = hasFavoritesCount(a);
  const bKnown = hasFavoritesCount(b);
  if (aKnown !== bKnown) return aKnown ? -1 : 1;
  if (!aKnown) return normalizeTitle(a.title).localeCompare(normalizeTitle(b.title), 'ja');

  const difference = Number(a.favorite_count) - Number(b.favorite_count);
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
    const searchable = `${normalizeTitle(work.title)} ${workTags(work, 20).join(' ')}`;
    const matchesSearch = !query || normalizeText(searchable).includes(query);
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
    const count = Number(work.favorite_count);
    if (count !== previousCount) currentRank = index + 1;
    ranks.set(String(work.work_id), currentRank);
    previousCount = count;
  });
  return ranks;
}

function loadClickHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && entry.work_id && entry.title && Number.isFinite(Number(entry.count)))
      .map((entry) => ({
        work_id: String(entry.work_id),
        title: String(entry.title),
        year: Number(entry.year) || null,
        tags: unique(toArray(entry.tags).map(String)).slice(0, 20),
        count: Math.max(1, Number(entry.count)),
        clicked_at: String(entry.clicked_at || ''),
      }))
      .sort((a, b) => Date.parse(b.clicked_at) - Date.parse(a.clicked_at))
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function saveClickHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.clickHistory.slice(0, HISTORY_LIMIT)));
  } catch {
    // Browsers may deny storage in private or restricted contexts. Recommendations still work in-memory.
  }
}

function recordWorkClick(work) {
  const workId = String(work.work_id || '');
  if (!workId) return;
  const existing = state.clickHistory.find((entry) => entry.work_id === workId);
  const record = {
    work_id: workId,
    title: normalizeTitle(work.title),
    year: Number(work.year || state.currentYear) || null,
    tags: workTags(work, 20),
    count: (existing?.count || 0) + 1,
    clicked_at: new Date().toISOString(),
  };
  state.clickHistory = [record, ...state.clickHistory.filter((entry) => entry.work_id !== workId)]
    .slice(0, HISTORY_LIMIT);
  saveClickHistory();
  renderRecommendations();
}

function buildPreferenceWeights() {
  const weights = new Map();
  const now = Date.now();
  for (const entry of state.clickHistory) {
    const clickedAt = Date.parse(entry.clicked_at);
    const ageDays = Number.isFinite(clickedAt) ? Math.max(0, (now - clickedAt) / 86_400_000) : 365;
    const recency = 1 + Math.exp(-ageDays / 45);
    const clickWeight = Math.log2(Number(entry.count) + 1) * recency;
    for (const tag of entry.tags) {
      const key = normalizeText(tag);
      if (!key) continue;
      const current = weights.get(key) || { label: tag, weight: 0 };
      current.weight += clickWeight;
      weights.set(key, current);
    }
  }
  return weights;
}

function recommendationCandidates() {
  const applyPreference = elements.preferenceToggle.checked && state.metadataAvailable;
  const candidates = state.works.filter((work) => !(applyPreference && matchesPreferenceExclusion(work)));
  const preferenceWeights = buildPreferenceWeights();
  const maxPopularity = Math.max(1, ...candidates.map((work) => (
    hasFavoritesCount(work) ? Math.log1p(Number(work.favorite_count)) : 0
  )));
  const historyById = new Map(state.clickHistory.map((entry) => [entry.work_id, entry]));

  return candidates.map((work) => {
    const tags = workTags(work, 20);
    const shared = tags
      .map((tag) => ({ tag, weight: preferenceWeights.get(normalizeText(tag))?.weight || 0 }))
      .filter(({ weight }) => weight > 0)
      .sort((a, b) => b.weight - a.weight);
    const affinity = shared.reduce((sum, item) => sum + item.weight, 0);
    const popularity = hasFavoritesCount(work)
      ? Math.log1p(Number(work.favorite_count)) / maxPopularity
      : 0;
    const priorClicks = historyById.get(String(work.work_id))?.count || 0;
    const exploration = priorClicks ? -Math.min(1.5, priorClicks * 0.35) : 0.35;
    const score = (affinity * 2.5) + (popularity * 2) + exploration;
    const reason = shared.length
      ? `閲覧傾向「${shared[0].tag}」と一致`
      : hasFavoritesCount(work)
        ? `気になる登録 ${formatNumber(work.favorite_count)}件`
        : '未閲覧作品から選出';
    return { work, score, reason };
  }).sort((a, b) => b.score - a.score
    || compareFavorites(a.work, b.work, -1)
    || normalizeTitle(a.work.title).localeCompare(normalizeTitle(b.work.title), 'ja'));
}

function renderTagChips(container, tags) {
  container.replaceChildren(...tags.map((tag) => {
    const chip = document.createElement('span');
    chip.textContent = tag;
    return chip;
  }));
  container.hidden = tags.length === 0;
}

function createWorkCard(work, ranks, { reason = '', recommendation = false } = {}) {
  const card = elements.cardTemplate.content.cloneNode(true);
  const article = card.querySelector('.work-card');
  const link = card.querySelector('.work-card__link');
  const image = card.querySelector('.work-card__image');
  const title = normalizeTitle(work.title);
  const rank = ranks.get(String(work.work_id));
  const favoritesText = hasFavoritesCount(work)
    ? `気になる ${formatNumber(work.favorite_count)}件${rank ? ` · #${rank}` : ''}`
    : '気になる —';

  if (recommendation) article.classList.add('work-card--recommendation');
  link.href = work.detail_url || work.source_tag_url || '#';
  link.setAttribute('aria-label', `${title}を公式ページで確認`);
  link.addEventListener('click', () => recordWorkClick(work));

  if (work.image_url) {
    image.src = work.image_url;
    image.alt = `${title}の作品画像`;
    image.addEventListener('error', () => image.remove(), { once: true });
  } else {
    image.remove();
  }

  card.querySelector('.work-card__year').textContent = `${work.year || state.currentYear}年`;
  card.querySelector('.work-card__title').textContent = title;
  card.querySelector('.work-card__meta').textContent = favoritesText;
  renderTagChips(card.querySelector('.work-card__tags'), workTags(work, recommendation ? 4 : 5));

  const reasonElement = card.querySelector('.work-card__reason');
  reasonElement.textContent = reason;
  reasonElement.hidden = !reason;
  return card;
}

function renderHistorySummary() {
  elements.historySummary.replaceChildren();
  const totalClicks = state.clickHistory.reduce((sum, entry) => sum + Number(entry.count), 0);
  elements.resetHistoryButton.disabled = totalClicks === 0;

  if (!totalClicks) {
    elements.historySummary.textContent = '作品を開くと、このブラウザ内に閲覧傾向が保存されます。';
    return;
  }

  const label = document.createElement('span');
  label.textContent = `最近見た（計${formatNumber(totalClicks)}クリック）`;
  elements.historySummary.append(label);
  for (const entry of state.clickHistory.slice(0, 5)) {
    const chip = document.createElement('span');
    chip.className = 'history-chip';
    chip.textContent = `${entry.title}${entry.count > 1 ? ` ×${entry.count}` : ''}`;
    elements.historySummary.append(chip);
  }
}

function renderRecommendations() {
  renderHistorySummary();
  const ranks = buildFavoritesRanks();
  const recommendations = recommendationCandidates().slice(0, RECOMMENDATION_LIMIT);
  const totalClicks = state.clickHistory.reduce((sum, entry) => sum + Number(entry.count), 0);
  elements.recommendationStatus.textContent = totalClicks
    ? 'このブラウザのクリック履歴と作品オントロジーを照合して順位付けしています。履歴は外部送信しません。'
    : 'クリック履歴がないため、現在は「気になる登録数」を中心に表示しています。';
  elements.recommendationGrid.replaceChildren(...recommendations.map(({ work, reason }) => (
    createWorkCard(work, ranks, { reason, recommendation: true })
  )));
  elements.recommendationSection.hidden = recommendations.length === 0;
}

function renderWorks() {
  const sorted = sortedWorks(filteredWorks());
  const ranks = buildFavoritesRanks();
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
  for (const work of sorted) fragment.append(createWorkCard(work, ranks));
  elements.workGrid.append(fragment);
  renderRecommendations();
  syncUrl();
}

async function loadLegacyFavorites(year) {
  try {
    const response = await fetch(`./data/likes/${year}.tsv`, { cache: 'no-cache' });
    if (!response.ok) return { byId: new Map(), byTitle: new Map() };
    const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
    const byId = new Map();
    const byTitle = new Map();

    for (const line of lines.slice(1)) {
      const columns = line.split('\t');
      if (columns.length === 3) {
        const [workId, title, countText] = columns;
        const count = Number(countText);
        if (workId && Number.isFinite(count)) byId.set(workId, count);
        if (title && Number.isFinite(count)) byTitle.set(normalizeLookupTitle(title), count);
      } else if (columns.length === 2) {
        const [title, countText] = columns;
        const count = Number(countText);
        if (title && Number.isFinite(count)) byTitle.set(normalizeLookupTitle(title), count);
      }
    }
    return { byId, byTitle };
  } catch {
    return { byId: new Map(), byTitle: new Map() };
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
    const officialWorks = Array.isArray(payload.works) ? payload.works : [];
    const hasEmbeddedCounts = officialWorks.every(hasFavoritesCount);
    const legacy = hasEmbeddedCounts
      ? { byId: new Map(), byTitle: new Map() }
      : await loadLegacyFavorites(state.currentYear);

    state.works = officialWorks.map((work) => {
      if (hasFavoritesCount(work)) return work;
      const fallback = legacy.byId.get(String(work.work_id))
        ?? legacy.byTitle.get(normalizeLookupTitle(work.title));
      return {
        ...work,
        favorite_count: Number.isFinite(fallback) ? fallback : null,
      };
    });
    state.favoritesSource = hasEmbeddedCounts ? 'official-json' : 'legacy-tsv';
    state.favoritesAvailableCount = state.works.filter(hasFavoritesCount).length;
    state.metadataAvailable = state.works.some(hasPreferenceMetadata);
    elements.sourceLink.href = payload.source_url || state.manifest?.source?.tag_selector_url || '#';
    renderMetadataNotice();
    renderWorks();
  } catch (error) {
    state.works = [];
    state.favoritesAvailableCount = 0;
    state.favoritesSource = 'none';
    elements.visibleCount.textContent = '0';
    elements.resultSummary.textContent = '';
    elements.recommendationSection.hidden = true;
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
    const validSort = requestedSort
      && elements.sortSelect.querySelector(`option[value="${CSS.escape(requestedSort)}"]`);

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
elements.resetHistoryButton.addEventListener('click', () => {
  state.clickHistory = [];
  saveClickHistory();
  renderRecommendations();
});

initialize();
