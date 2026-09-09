const grid = document.querySelector('#workGrid');
const recommendationGrid = document.querySelector('#recommendationGrid');
const search = document.querySelector('#searchInput');
const sort = document.querySelector('#sortSelect');
const year = document.querySelector('#yearSelect');
const heading = document.querySelector('#yearTitle');
const kicker = document.querySelector('#yearKicker');
const summary = document.querySelector('#resultSummary');
const visible = document.querySelector('#visibleCount');
const filterBar = document.querySelector('#activeFilterBar');
const filterText = document.querySelector('#activeFilterText');
const filterSummary = document.querySelector('#filterSummary');
const clearButtons = [document.querySelector('#clearFilterButton'), document.querySelector('#mobileClearButton')];
const mobileText = document.querySelector('#mobileStatusText');
const catalogueList = document.querySelector('#catalogueList');
let activeTag = new URLSearchParams(location.search).get('tag') || '';
let scheduled = false;
let decorating = false;
let initializedFromUrl = false;

const normalize = (value) => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('ja');
const format = new Intl.NumberFormat('ja-JP');

function setUrl(mode = 'replace') {
  const url = new URL(location.href);
  activeTag ? url.searchParams.set('tag', activeTag) : url.searchParams.delete('tag');
  history[`${mode}State`](null, '', url);
}

function tagLabels(card) {
  return [...card.querySelectorAll('.work-card__tags .tag-chip, .work-card__tags span')]
    .map((node) => node.textContent.trim())
    .filter(Boolean);
}

function moveTagsOutsideLink(card) {
  const link = card.querySelector('.work-card__link');
  const tags = link?.querySelector('.work-card__tags');
  if (link && tags) card.append(tags);
}

function makeTagButtons(container) {
  [...container.querySelectorAll('.work-card__tags')].forEach((tagBox) => {
    [...tagBox.querySelectorAll('span')].forEach((span) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tag-chip';
      button.textContent = span.textContent;
      button.addEventListener('click', () => activateTag(button.textContent));
      span.replaceWith(button);
    });
    [...tagBox.querySelectorAll('.tag-chip')].forEach((button) => {
      button.setAttribute('aria-pressed', String(normalize(button.textContent) === normalize(activeTag)));
    });
  });
}

function countFrom(card) {
  const match = card.querySelector('.work-card__meta')?.textContent.match(/気になる\s*([\d,]+)件/);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

function applyExactRanking() {
  const cards = [...grid.querySelectorAll('.work-card')];
  const recommendationCards = [...recommendationGrid.querySelectorAll('.work-card')];
  cards.forEach(moveTagsOutsideLink);
  recommendationCards.forEach(moveTagsOutsideLink);
  makeTagButtons(grid);
  makeTagButtons(recommendationGrid);

  if (!activeTag) {
    cards.forEach((card) => { card.hidden = false; });
    filterBar.hidden = true;
    clearButtons.forEach((button) => { button.hidden = true; });
    filterSummary.textContent = `${year.value || ''}年`;
    kicker.textContent = `${year.value || ''} YEAR CATALOGUE`;
    heading.textContent = `${year.value || ''}年のアニメ`;
    mobileText.textContent = `${year.value || ''}年 · ${format.format(cards.length)}件`;
    return;
  }

  const exact = cards.filter((card) => tagLabels(card).some((tag) => normalize(tag) === normalize(activeTag)));
  cards.forEach((card) => { card.hidden = !exact.includes(card); });
  let previous = null;
  let rank = 0;
  exact.forEach((card, index) => {
    const count = countFrom(card);
    if (count !== previous) rank = index + 1;
    const meta = card.querySelector('.work-card__meta');
    if (meta && count !== null) meta.textContent = `気になる ${format.format(count)}件 · タグ内 #${rank}`;
    previous = count;
  });

  const label = `「${activeTag}」の気になるランキング`;
  filterBar.hidden = false;
  filterText.textContent = label;
  clearButtons.forEach((button) => { button.hidden = false; });
  filterSummary.textContent = `${year.value || ''}年 · ${activeTag}`;
  kicker.textContent = 'TAG RANKING';
  heading.textContent = `${activeTag}の気になるランキング`;
  visible.textContent = format.format(exact.length);
  mobileText.textContent = `${activeTag} · ${format.format(exact.length)}件`;
  summary.textContent = `${format.format(exact.length)}件表示・タグ完全一致・気になる登録数順・タグ内順位`;
}

function decorate() {
  if (decorating) return;
  decorating = true;
  observer.disconnect();
  applyExactRanking();
  observer.observe(grid, { childList: true, subtree: true });
  observer.observe(recommendationGrid, { childList: true, subtree: true });
  decorating = false;
}

function scheduleDecorate() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (activeTag && !initializedFromUrl && grid.children.length) {
      initializedFromUrl = true;
      activateTag(activeTag, { push: false, scroll: false });
      return;
    }
    decorate();
  });
}

function activateTag(tag, { push = true, scroll = true } = {}) {
  activeTag = String(tag || '').trim();
  if (!activeTag) return;
  search.value = activeTag;
  search.dispatchEvent(new Event('input', { bubbles: true }));
  sort.value = 'favorites-desc';
  sort.dispatchEvent(new Event('change', { bubbles: true }));
  setUrl(push ? 'push' : 'replace');
  scheduleDecorate();
  if (scroll) {
    catalogueList.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => catalogueList.focus({ preventScroll: true }), 250);
  }
}

function clearTag({ push = true } = {}) {
  if (!activeTag) return;
  activeTag = '';
  search.value = '';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  setUrl(push ? 'push' : 'replace');
  scheduleDecorate();
}

const observer = new MutationObserver(scheduleDecorate);
observer.observe(grid, { childList: true, subtree: true });
observer.observe(recommendationGrid, { childList: true, subtree: true });
clearButtons.forEach((button) => button.addEventListener('click', () => clearTag()));
search.addEventListener('input', () => {
  if (activeTag && normalize(search.value) !== normalize(activeTag)) {
    activeTag = '';
    setUrl('replace');
  }
  scheduleDecorate();
});
year.addEventListener('change', () => { activeTag = ''; setUrl('replace'); scheduleDecorate(); });
addEventListener('popstate', () => {
  const next = new URLSearchParams(location.search).get('tag') || '';
  next ? activateTag(next, { push: false, scroll: false }) : clearTag({ push: false });
});
scheduleDecorate();
