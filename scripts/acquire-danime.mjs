import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  OFFICIAL_ORIGIN,
  TAG_SELECTOR_URL,
  mergeCanonical,
  normalizeText,
  sanitizeTitle,
  tagIdFromUrl,
  workIdFromUrl,
} from './lib/catalog.mjs';

const OUTPUT_DIR = path.resolve('data');
const DIAGNOSTICS_DIR = path.resolve('diagnostics');
const RATE_LIMIT_MS = Number(process.env.DANIME_RATE_LIMIT_MS ?? 1200);
const MAX_LIST_PAGES = Number(process.env.DANIME_MAX_LIST_PAGES ?? 100);
const MIN_EXPECTED_YEAR_TAGS = Number(process.env.DANIME_MIN_YEAR_TAGS ?? 60);
const ONLY_YEAR = process.env.DANIME_YEAR ? Number(process.env.DANIME_YEAR) : null;
const ACQUIRED_AT = new Date().toISOString();

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function absoluteUrl(value) {
  try {
    return value ? new URL(value, OFFICIAL_ORIGIN).toString() : null;
  } catch {
    return null;
  }
}

function shortHash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function inferWorksFromJson(node, sourceUrl, output = [], depth = 0) {
  if (depth > 12 || node == null) return output;
  if (Array.isArray(node)) {
    for (const item of node) inferWorksFromJson(item, sourceUrl, output, depth + 1);
    return output;
  }
  if (typeof node !== 'object') return output;

  const directId = node.workId ?? node.workID ?? node.work_id ?? null;
  const linkedId = [node.url, node.link, node.href, node.detailUrl, node.detail_url]
    .map(workIdFromUrl)
    .find(Boolean);
  const workId = directId && /^[A-Za-z0-9_-]+$/.test(String(directId))
    ? String(directId)
    : linkedId;
  const title = sanitizeTitle(node.workTitle ?? node.workName ?? node.title ?? node.name ?? null);

  if (workId && title) {
    output.push({
      work_id: workId,
      title,
      detail_url: absoluteUrl(
        node.detailUrl ?? node.detail_url ?? node.url ?? node.link ?? node.href ??
          `/animestore/ci_pc?workId=${encodeURIComponent(workId)}`,
      ),
      image_url: absoluteUrl(
        node.imageUrl ?? node.image_url ?? node.thumbnailUrl ?? node.thumbnail_url ??
          node.mainVisualUrl ?? node.jacketImageUrl ?? null,
      ),
      extraction_method: 'official-json',
      extraction_source_url: sourceUrl,
    });
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') inferWorksFromJson(value, sourceUrl, output, depth + 1);
  }
  return output;
}

function dedupeWorks(works) {
  const map = new Map();
  for (const candidate of works) {
    const workId = candidate.work_id ?? workIdFromUrl(candidate.detail_url);
    const title = sanitizeTitle(candidate.title);
    if (!workId || !title) continue;

    const current = map.get(workId);
    if (!current) {
      map.set(workId, {
        work_id: workId,
        title,
        detail_url: absoluteUrl(candidate.detail_url) ??
          `${OFFICIAL_ORIGIN}/animestore/ci_pc?workId=${encodeURIComponent(workId)}`,
        image_url: absoluteUrl(candidate.image_url),
        extraction_method: candidate.extraction_method ?? 'dom',
        extraction_source_url: absoluteUrl(candidate.extraction_source_url),
      });
      continue;
    }

    if ((!current.title || current.title.startsWith('work:')) && title) current.title = title;
    if (!current.image_url && candidate.image_url) current.image_url = absoluteUrl(candidate.image_url);
    if (current.extraction_method !== 'dom' && candidate.extraction_method === 'dom') {
      current.extraction_method = 'dom';
    }
  }
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'ja'));
}

async function ensureDirectories() {
  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await rm(DIAGNOSTICS_DIR, { recursive: true, force: true });
  await mkdir(path.join(OUTPUT_DIR, 'by-year'), { recursive: true });
  await mkdir(path.join(OUTPUT_DIR, 'source'), { recursive: true });
  await mkdir(path.join(DIAGNOSTICS_DIR, 'pages'), { recursive: true });
  await mkdir(path.join(DIAGNOSTICS_DIR, 'network'), { recursive: true });
}

async function savePageDiagnostics(page, label) {
  const safe = label.replace(/[^A-Za-z0-9_-]+/g, '-');
  await writeFile(
    path.join(DIAGNOSTICS_DIR, 'pages', `${safe}.html`),
    await page.content(),
    'utf8',
  );
  await page.screenshot({
    path: path.join(DIAGNOSTICS_DIR, 'pages', `${safe}.png`),
    fullPage: false,
    animations: 'disabled',
  }).catch((error) => {
    console.warn(`Diagnostic screenshot skipped for ${label}: ${error.message}`);
  });
}

async function discoverYearTags(page) {
  const response = await page.goto(TAG_SELECTOR_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  if (!response || response.status() >= 400) {
    throw new Error(`Official tag selector returned ${response?.status() ?? 'no response'}.`);
  }
  await page.waitForTimeout(3500);
  await savePageDiagnostics(page, 'tag-selector');

  const raw = await page.locator('a[href*="tag_pc?tagId="]').evaluateAll((anchors) =>
    anchors.map((anchor) => ({
      label: String(anchor.textContent ?? '').replace(/\s+/g, ' ').trim(),
      href: anchor.href,
    })),
  );

  const byYear = new Map();
  for (const candidate of raw) {
    const match = normalizeText(candidate.label).match(/^((?:19|20)\d{2})年$/u);
    if (!match) continue;
    const year = Number(match[1]);
    const tagId = tagIdFromUrl(candidate.href);
    if (!tagId) continue;

    const existing = byYear.get(year);
    if (existing && existing.tag_id !== tagId) {
      throw new Error(`Conflicting official tag IDs for ${year}: ${existing.tag_id}, ${tagId}`);
    }
    byYear.set(year, {
      year,
      tag_id: tagId,
      label: `${year}年`,
      url: `${OFFICIAL_ORIGIN}/animestore/tag_pc?tagId=${tagId}`,
      discovery_method: 'exact-official-anchor',
    });
  }

  const allTags = [...byYear.values()].sort((a, b) => a.year - b.year);
  if (ONLY_YEAR) {
    const selected = allTags.filter((item) => item.year === ONLY_YEAR);
    if (selected.length !== 1) throw new Error(`Official exact-year tag not found for ${ONLY_YEAR}.`);
    return selected;
  }

  const currentYear = new Date().getUTCFullYear();
  const years = allTags.map((item) => item.year);
  if (allTags.length < MIN_EXPECTED_YEAR_TAGS) {
    throw new Error(`Only ${allTags.length} exact-year tags found; expected at least ${MIN_EXPECTED_YEAR_TAGS}.`);
  }
  if (!years.includes(currentYear)) {
    throw new Error(`Current year ${currentYear} is absent from the official exact-year tags.`);
  }
  if (Math.min(...years) > 1950) {
    throw new Error(`Historical coverage is unexpectedly truncated at ${Math.min(...years)}.`);
  }

  console.log(
    `Discovered ${allTags.length} exact-year tags (${Math.min(...years)}-${Math.max(...years)}).`,
  );
  return allTags;
}

async function exhaustDynamicList(page) {
  let stableRounds = 0;
  let previousCount = -1;

  for (let round = 0; round < 80 && stableRounds < 4; round += 1) {
    const before = await page.locator('a[href*="workId="]').count();
    let clicked = false;

    const candidates = page.getByRole('button', {
      name: /もっと見る|さらに表示|続きを表示|次へ/i,
    });
    for (let index = 0; index < await candidates.count(); index += 1) {
      const button = candidates.nth(index);
      if (await button.isVisible().catch(() => false)) {
        await button.click({ timeout: 3000 }).catch(() => undefined);
        clicked = true;
        break;
      }
    }

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(clicked ? 1800 : 900);
    const after = await page.locator('a[href*="workId="]').count();

    if (after <= before && after === previousCount) stableRounds += 1;
    else stableRounds = 0;
    previousCount = after;
  }
}

async function extractDomWorks(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\t\r\n]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const records = [];
    for (const anchor of document.querySelectorAll('a[href*="workId="]')) {
      const detailUrl = new URL(anchor.getAttribute('href'), location.origin).toString();
      const workId = new URL(detailUrl).searchParams.get('workId');
      if (!workId) continue;

      const container = anchor.closest(
        'li, article, [class*="item"], [class*="work"], [class*="card"], [class*="list"]',
      );
      const image = anchor.querySelector('img') ?? container?.querySelector('img');
      const titleElement = container?.querySelector(
        '[class*="title"], [class*="ttl"], [class*="name"], h2, h3, h4',
      );
      const title = [
        anchor.getAttribute('aria-label'),
        anchor.getAttribute('title'),
        image?.getAttribute('alt'),
        titleElement?.textContent,
        anchor.textContent,
      ].map(clean).find((value) => value && value.length <= 240) ?? null;
      const imageUrl = image?.currentSrc || image?.src ||
        image?.getAttribute('data-src') || image?.getAttribute('data-original') || null;

      records.push({
        work_id: workId,
        title,
        detail_url: detailUrl,
        image_url: imageUrl ? new URL(imageUrl, location.origin).toString() : null,
        extraction_method: 'dom',
        extraction_source_url: location.href,
      });
    }
    return records;
  });
}

async function paginationLinks(page, tagId) {
  return page.evaluate((expectedTagId) => {
    const links = [];
    for (const anchor of document.querySelectorAll('a[href]')) {
      const raw = anchor.getAttribute('href');
      if (!raw) continue;
      const url = new URL(raw, location.origin);
      if (!url.pathname.endsWith('/tag_pc')) continue;
      if (url.searchParams.get('tagId') !== expectedTagId) continue;
      const text = String(anchor.textContent ?? '').trim();
      const hasPagingParam = [...url.searchParams.keys()]
        .some((key) => /page|offset|start|limit|index/i.test(key));
      const looksLikePager = hasPagingParam || /^(?:次へ|前へ|\d+|>|<|»|«)$/u.test(text);
      if (looksLikePager) links.push(url.toString());
    }
    return [...new Set(links)];
  }, tagId);
}

async function acquireYear(page, tag, networkWorksByYear, setActiveYear) {
  const queue = [tag.url];
  const visited = new Set();
  const domWorks = [];

  try {
    while (queue.length > 0 && visited.size < MAX_LIST_PAGES) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);

      setActiveYear(tag.year);
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 90_000,
      });
      if (!response || response.status() >= 400) {
        throw new Error(
          `${tag.year}: official tag page returned ${response?.status() ?? 'no response'}: ${url}`,
        );
      }
      await page.waitForTimeout(2500);
      await exhaustDynamicList(page);
      domWorks.push(...await extractDomWorks(page));

      const links = await paginationLinks(page, tag.tag_id);
      for (const link of links) {
        if (!visited.has(link) && !queue.includes(link)) queue.push(link);
      }
      await sleep(RATE_LIMIT_MS);
    }
  } catch (error) {
    await savePageDiagnostics(page, `${tag.year}-failure`).catch(() => undefined);
    throw error;
  }

  const works = dedupeWorks([
    ...domWorks,
    ...(networkWorksByYear.get(tag.year) ?? []),
  ]).map((work) => ({
    ...work,
    year: tag.year,
    source_tag_id: tag.tag_id,
    source_tag_url: tag.url,
    acquired_at: ACQUIRED_AT,
  }));

  if (works.length === 0) {
    await savePageDiagnostics(page, `${tag.year}-empty`).catch(() => undefined);
    throw new Error(`${tag.year}: no works extracted from official tag ${tag.tag_id}`);
  }
  return { works, pages_visited: visited.size };
}

async function main() {
  await ensureDirectories();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    userAgent: 'KAFKA2306-anime-catalogue/0.1 (+https://github.com/KAFKA2306/anime; public metadata only)',
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const responseTasks = [];
  const networkWorksByYear = new Map();
  const networkManifest = [];
  let activeYear = null;

  context.on('response', (response) => {
    const task = (async () => {
      const url = response.url();
      const contentType = response.headers()['content-type'] ?? '';
      const year = activeYear;
      if (!year || !url.startsWith(OFFICIAL_ORIGIN) ||
          !contentType.includes('json') || response.status() >= 400) return;
      try {
        const text = await response.text();
        if (text.length > 8_000_000) return;
        const parsed = JSON.parse(text);
        const inferred = inferWorksFromJson(parsed, url);
        if (inferred.length > 0) {
          const relative = path.join('network', `${year}-${shortHash(url)}.json`);
          await writeFile(
            path.join(DIAGNOSTICS_DIR, relative),
            JSON.stringify(parsed, null, 2),
            'utf8',
          );
          networkWorksByYear.set(year, [
            ...(networkWorksByYear.get(year) ?? []),
            ...inferred,
          ]);
          networkManifest.push({
            year,
            url,
            status: response.status(),
            file: relative,
            inferred_work_count: inferred.length,
          });
        }
      } catch {
        // DOM extraction remains authoritative if a JSON response is unreadable.
      }
    })();
    responseTasks.push(task);
  });

  try {
    const yearTags = await discoverYearTags(page);
    const byYear = {};
    const acquisitionStats = {};
    const acquisitionOrder = [...yearTags].sort((a, b) => b.year - a.year);

    for (const tag of acquisitionOrder) {
      const result = await acquireYear(
        page,
        tag,
        networkWorksByYear,
        (year) => { activeYear = year; },
      );
      byYear[tag.year] = result.works;
      acquisitionStats[tag.year] = {
        tag_id: tag.tag_id,
        source_url: tag.url,
        pages_visited: result.pages_visited,
        work_count: result.works.length,
      };
      console.log(`${tag.year}: ${result.works.length} works from ${result.pages_visited} page(s)`);
    }

    activeYear = null;
    await Promise.allSettled(responseTasks);

    const canonicalWorks = mergeCanonical(byYear);
    const manifest = {
      schema_version: '1.0.0',
      generated_at: ACQUIRED_AT,
      source: {
        name: 'dアニメストア',
        operator: '株式会社NTTドコモ',
        official_origin: OFFICIAL_ORIGIN,
        tag_selector_url: TAG_SELECTOR_URL,
        scope: 'Public catalogue metadata from exact year tags; no video, login-only data, reviews, or user data.',
      },
      discovered_years: yearTags.map((tag) => tag.year),
      year_count: yearTags.length,
      canonical_work_count: canonicalWorks.length,
      membership_count: Object.values(byYear).reduce((sum, works) => sum + works.length, 0),
      acquisition: acquisitionStats,
      integrity: {
        duplicate_work_ids_within_year: 0,
        missing_titles: 0,
        empty_years: 0,
      },
    };

    for (const tag of yearTags) {
      const payload = {
        schema_version: '1.0.0',
        year: tag.year,
        source_tag_id: tag.tag_id,
        source_url: tag.url,
        generated_at: ACQUIRED_AT,
        count: byYear[tag.year].length,
        works: byYear[tag.year],
      };
      await writeFile(
        path.join(OUTPUT_DIR, 'by-year', `${tag.year}.json`),
        `${JSON.stringify(payload, null, 2)}\n`,
        'utf8',
      );
    }

    await writeFile(
      path.join(OUTPUT_DIR, 'works.json'),
      `${JSON.stringify(canonicalWorks, null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      path.join(OUTPUT_DIR, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      path.join(OUTPUT_DIR, 'source', 'year-tags.json'),
      `${JSON.stringify(yearTags, null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      path.join(DIAGNOSTICS_DIR, 'network-manifest.json'),
      `${JSON.stringify(networkManifest, null, 2)}\n`,
      'utf8',
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
