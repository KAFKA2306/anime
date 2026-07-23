import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  OFFICIAL_ORIGIN,
  TAG_SELECTOR_URL,
  mergeCanonical,
  normalizeText,
  tagIdFromUrl,
} from './lib/catalog.mjs';
import {
  buildOfficialListUrl,
  parseOfficialListDocument,
  stableWorkContent,
} from './lib/official-api.mjs';

const FINAL_DATA_DIR = path.resolve('data');
const FINAL_DIAGNOSTICS_DIR = path.resolve('diagnostics');
const RUN_ROOT = path.resolve('.tmp', `danime-${Date.now()}-${process.pid}`);
const OUTPUT_DIR = path.join(RUN_ROOT, 'data');
const DIAGNOSTICS_DIR = path.join(RUN_ROOT, 'diagnostics');
const RATE_LIMIT_MS = Number(process.env.DANIME_RATE_LIMIT_MS ?? 1200);
const PAGE_SIZE = Number(process.env.DANIME_API_PAGE_SIZE ?? 20);
const MAX_API_PAGES = Number(process.env.DANIME_MAX_API_PAGES ?? 500);
const MAX_RETRIES = Number(process.env.DANIME_MAX_RETRIES ?? 5);
const REQUEST_TIMEOUT_MS = Number(process.env.DANIME_REQUEST_TIMEOUT_MS ?? 45_000);
const MIN_EXPECTED_YEAR_TAGS = Number(process.env.DANIME_MIN_YEAR_TAGS ?? 60);
const CONTINUOUS_START_YEAR = Number(process.env.DANIME_CONTINUOUS_START_YEAR ?? 1962);
const MAX_TOTAL_DROP_RATIO = Number(process.env.DANIME_MAX_TOTAL_DROP_RATIO ?? 0.10);
const ONLY_YEAR = process.env.DANIME_YEAR ? Number(process.env.DANIME_YEAR) : null;
const ACQUIRED_AT = new Date().toISOString();

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function contentHash(works) {
  return sha256(JSON.stringify(works.map(stableWorkContent)));
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJsonIfExists(file) {
  if (!await exists(file)) return null;
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function prepareRunDirectories() {
  await rm(RUN_ROOT, { recursive: true, force: true });
  await mkdir(path.join(OUTPUT_DIR, 'by-year'), { recursive: true });
  await mkdir(path.join(OUTPUT_DIR, 'source'), { recursive: true });
  await mkdir(path.join(OUTPUT_DIR, 'likes'), { recursive: true });
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
  await page.waitForTimeout(2500);
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

    const current = byYear.get(year);
    if (current && current.tag_id !== tagId) {
      throw new Error(`Conflicting official tag IDs for ${year}: ${current.tag_id}, ${tagId}`);
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
    return { tags: selected, warnings: [] };
  }

  if (allTags.length < MIN_EXPECTED_YEAR_TAGS) {
    throw new Error(`Only ${allTags.length} exact-year tags found; expected at least ${MIN_EXPECTED_YEAR_TAGS}.`);
  }

  const years = allTags.map((item) => item.year);
  const maxYear = Math.max(...years);
  const currentYear = new Date().getUTCFullYear();
  const warnings = [];
  if (maxYear < currentYear - 1) {
    throw new Error(`Newest official exact-year tag is ${maxYear}; current year is ${currentYear}.`);
  }
  if (maxYear === currentYear - 1) {
    warnings.push(`Current-year tag ${currentYear} is not published yet; newest exact tag is ${maxYear}.`);
  }
  if (maxYear > currentYear + 1) {
    throw new Error(`Unexpected future year tag ${maxYear}.`);
  }

  for (let year = CONTINUOUS_START_YEAR; year <= maxYear; year += 1) {
    if (!byYear.has(year)) throw new Error(`Official exact-year coverage has a gap at ${year}.`);
  }

  console.log(`Discovered ${allTags.length} exact-year tags (${Math.min(...years)}-${maxYear}).`);
  return { tags: allTags, warnings };
}

class RateLimiter {
  #nextAllowedAt = 0;

  async wait() {
    const now = Date.now();
    const delay = Math.max(0, this.#nextAllowedAt - now);
    if (delay > 0) await sleep(delay);
    this.#nextAllowedAt = Date.now() + RATE_LIMIT_MS;
  }
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchJsonWithRetry(request, limiter, url, referer, label) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    await limiter.wait();
    try {
      const response = await request.get(url, {
        timeout: REQUEST_TIMEOUT_MS,
        failOnStatusCode: false,
        headers: {
          accept: 'application/json, text/plain, */*',
          referer,
          'x-requested-with': 'XMLHttpRequest',
        },
      });
      const status = response.status();
      const text = await response.text();
      if (status >= 200 && status < 300) {
        try {
          return { document: JSON.parse(text), status, headers: response.headers() };
        } catch (error) {
          throw new Error(`${label}: invalid JSON (${error.message}).`);
        }
      }
      if (!isRetryableStatus(status)) {
        throw new Error(`${label}: HTTP ${status}; ${text.slice(0, 200)}`);
      }
      lastError = new Error(`${label}: retryable HTTP ${status}.`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < MAX_RETRIES) {
      const backoff = Math.min(30_000, 1000 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 500);
      console.warn(`${label}: attempt ${attempt}/${MAX_RETRIES} failed; retrying in ${backoff}ms.`);
      await sleep(backoff);
    }
  }
  throw lastError ?? new Error(`${label}: request failed.`);
}

async function acquireOfficialYear(request, limiter, tag) {
  const works = new Map();
  const responseRecords = [];
  let declaredCount = null;
  let start = 0;
  let pageNumber = 0;

  while (pageNumber < MAX_API_PAGES) {
    const requestUrl = buildOfficialListUrl({
      tagId: tag.tag_id,
      start,
      length: PAGE_SIZE,
      cacheBust: `${Date.now()}${pageNumber}`,
    });
    const label = `${tag.year} start=${start}`;
    const result = await fetchJsonWithRetry(request, limiter, requestUrl, tag.url, label);
    const parsed = parseOfficialListDocument(result.document, {
      expectedTagId: tag.tag_id,
      requestUrl,
    });

    if (declaredCount === null) declaredCount = parsed.maxCount;
    if (declaredCount !== parsed.maxCount) {
      throw new Error(`${tag.year}: maxCount changed during pagination (${declaredCount} -> ${parsed.maxCount}).`);
    }

    const diagnosticFile = path.join('network', `${tag.year}-start-${String(start).padStart(5, '0')}.json`);
    await writeJson(path.join(DIAGNOSTICS_DIR, diagnosticFile), result.document);
    responseRecords.push({
      start,
      count: parsed.count,
      max_count: parsed.maxCount,
      status: result.status,
      source_url: parsed.sourceUrl,
      file: diagnosticFile,
    });

    let added = 0;
    for (const work of parsed.works) {
      const current = works.get(work.work_id);
      if (current && current.title !== work.title) {
        throw new Error(`${tag.year}: conflicting titles for work ${work.work_id}.`);
      }
      if (!current) added += 1;
      works.set(work.work_id, {
        ...work,
        year: tag.year,
        source_tag_id: tag.tag_id,
        source_tag_url: tag.url,
        acquired_at: ACQUIRED_AT,
      });
    }

    if (works.size >= declaredCount) break;
    if (parsed.count === 0 || added === 0) {
      throw new Error(`${tag.year}: pagination made no progress at start=${start}.`);
    }
    start += PAGE_SIZE;
    pageNumber += 1;
  }

  if (declaredCount === null) throw new Error(`${tag.year}: no official JSON response.`);
  if (works.size !== declaredCount) {
    throw new Error(`${tag.year}: acquired ${works.size} unique works, official maxCount=${declaredCount}.`);
  }

  const ordered = [...works.values()].sort((a, b) => a.title.localeCompare(b.title, 'ja'));
  return {
    works: ordered,
    declared_count: declaredCount,
    response_count: responseRecords.length,
    responses: responseRecords,
    content_sha256: contentHash(ordered),
  };
}

function buildChangeSummary(previousManifest, previousByYear, nextByYear) {
  const summary = {
    previous_generated_at: previousManifest?.generated_at ?? null,
    added_memberships: 0,
    removed_memberships: 0,
    title_changes: 0,
    favorite_count_changes: 0,
    years: {},
  };

  for (const [yearKey, nextWorks] of Object.entries(nextByYear)) {
    const previousWorks = previousByYear[yearKey] ?? [];
    const previousMap = new Map(previousWorks.map((work) => [work.work_id, work]));
    const nextMap = new Map(nextWorks.map((work) => [work.work_id, work]));
    const added = [...nextMap.keys()].filter((id) => !previousMap.has(id));
    const removed = [...previousMap.keys()].filter((id) => !nextMap.has(id));
    let titleChanges = 0;
    let favoriteChanges = 0;
    for (const [id, next] of nextMap) {
      const previous = previousMap.get(id);
      if (!previous) continue;
      if (previous.title !== next.title) titleChanges += 1;
      if (previous.favorite_count !== next.favorite_count) favoriteChanges += 1;
    }
    summary.added_memberships += added.length;
    summary.removed_memberships += removed.length;
    summary.title_changes += titleChanges;
    summary.favorite_count_changes += favoriteChanges;
    summary.years[yearKey] = {
      previous_count: previousWorks.length,
      next_count: nextWorks.length,
      added_work_ids: added,
      removed_work_ids: removed,
      title_changes: titleChanges,
      favorite_count_changes: favoriteChanges,
    };
  }
  return summary;
}

async function readPreviousSnapshot(yearTags) {
  const manifest = await readJsonIfExists(path.join(FINAL_DATA_DIR, 'manifest.json'));
  const byYear = {};
  for (const tag of yearTags) {
    const payload = await readJsonIfExists(path.join(FINAL_DATA_DIR, 'by-year', `${tag.year}.json`));
    if (payload?.works) byYear[tag.year] = payload.works;
  }
  return { manifest, byYear };
}

function validateDropGuard(previousManifest, nextMembershipCount) {
  const previous = Number(previousManifest?.membership_count ?? 0);
  if (!previous) return;
  const dropRatio = (previous - nextMembershipCount) / previous;
  if (dropRatio > MAX_TOTAL_DROP_RATIO) {
    throw new Error(
      `Membership count dropped ${(dropRatio * 100).toFixed(2)}%, exceeding ` +
      `DANIME_MAX_TOTAL_DROP_RATIO=${MAX_TOTAL_DROP_RATIO}.`,
    );
  }
}

async function promoteDirectory(staged, target) {
  const backup = `${target}.backup-${process.pid}`;
  await rm(backup, { recursive: true, force: true });
  const hadTarget = await exists(target);
  if (hadTarget) await rename(target, backup);
  try {
    await rename(staged, target);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    if (hadTarget && await exists(backup)) await rename(backup, target);
    throw error;
  }
}

async function writeSingleYearDiagnostic(tag, result) {
  const targetDir = path.join(FINAL_DIAGNOSTICS_DIR, 'single-year');
  await mkdir(targetDir, { recursive: true });
  await writeJson(path.join(targetDir, `${tag.year}.json`), {
    generated_at: ACQUIRED_AT,
    year: tag.year,
    source_tag_id: tag.tag_id,
    source_url: tag.url,
    declared_count: result.declared_count,
    response_count: result.response_count,
    content_sha256: result.content_sha256,
    works: result.works,
  });
  console.log(`${tag.year}: live diagnostic acquired ${result.works.length} official works; data/ was not modified.`);
}

async function main() {
  await prepareRunDirectories();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    userAgent: 'KAFKA2306-anime-catalogue/0.2 (+https://github.com/KAFKA2306/anime; public metadata only)',
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();

  try {
    const discovery = await discoverYearTags(page);
    const limiter = new RateLimiter();
    const acquisitionOrder = [...discovery.tags].sort((a, b) => b.year - a.year);
    const byYear = {};
    const acquisitionStats = {};

    for (const tag of acquisitionOrder) {
      const result = await acquireOfficialYear(context.request, limiter, tag);
      byYear[tag.year] = result.works;
      acquisitionStats[tag.year] = {
        tag_id: tag.tag_id,
        source_url: tag.url,
        transport: 'direct-official-json',
        api_endpoint: '/animestore/rest/WS000106',
        api_page_size: PAGE_SIZE,
        official_json_response_count: result.response_count,
        declared_work_count: result.declared_count,
        official_json_work_count: result.works.length,
        work_count: result.works.length,
        content_sha256: result.content_sha256,
      };
      console.log(`${tag.year}: ${result.works.length} works from ${result.response_count} official JSON response(s).`);
    }

    if (ONLY_YEAR) {
      await writeSingleYearDiagnostic(acquisitionOrder[0], {
        works: byYear[ONLY_YEAR],
        declared_count: acquisitionStats[ONLY_YEAR].declared_work_count,
        response_count: acquisitionStats[ONLY_YEAR].official_json_response_count,
        content_sha256: acquisitionStats[ONLY_YEAR].content_sha256,
      });
      return;
    }

    const canonicalWorks = mergeCanonical(byYear);
    const membershipCount = Object.values(byYear).reduce((sum, works) => sum + works.length, 0);
    const previous = await readPreviousSnapshot(discovery.tags);
    validateDropGuard(previous.manifest, membershipCount);
    const changeSummary = buildChangeSummary(previous.manifest, previous.byYear, byYear);

    const manifest = {
      schema_version: '2.0.0',
      generated_at: ACQUIRED_AT,
      source: {
        name: 'dアニメストア',
        operator: '株式会社NTTドコモ',
        official_origin: OFFICIAL_ORIGIN,
        tag_selector_url: TAG_SELECTOR_URL,
        official_list_api: `${OFFICIAL_ORIGIN}/animestore/rest/WS000106`,
        scope: 'Public catalogue metadata from exact year tags; no video, login-only data, reviews, or user data.',
      },
      discovered_years: discovery.tags.map((tag) => tag.year),
      year_count: discovery.tags.length,
      canonical_work_count: canonicalWorks.length,
      membership_count: membershipCount,
      acquisition: acquisitionStats,
      warnings: discovery.warnings,
      integrity: {
        duplicate_work_ids_within_year: 0,
        missing_titles: 0,
        empty_years: 0,
        official_count_mismatches: 0,
        non_official_titles: 0,
        missing_official_favorite_counts: 0,
        missing_official_my_list_counts: 0,
      },
    };

    for (const tag of discovery.tags) {
      const works = byYear[tag.year];
      await writeJson(path.join(OUTPUT_DIR, 'by-year', `${tag.year}.json`), {
        schema_version: '2.0.0',
        year: tag.year,
        source_tag_id: tag.tag_id,
        source_url: tag.url,
        generated_at: ACQUIRED_AT,
        declared_count: works.length,
        official_json_count: works.length,
        count: works.length,
        content_sha256: acquisitionStats[tag.year].content_sha256,
        works,
      });
      const likesTsv = [
        'title\tfavorites_count',
        ...works.map((work) => `${work.title}\t${work.favorite_count}`),
      ].join('\n');
      await writeFile(
        path.join(OUTPUT_DIR, 'likes', `${tag.year}.tsv`),
        `${likesTsv}\n`,
        'utf8',
      );
    }

    await writeJson(path.join(OUTPUT_DIR, 'works.json'), canonicalWorks);
    await writeJson(path.join(OUTPUT_DIR, 'manifest.json'), manifest);
    await writeJson(path.join(OUTPUT_DIR, 'source', 'year-tags.json'), discovery.tags);
    await writeJson(path.join(DIAGNOSTICS_DIR, 'change-summary.json'), changeSummary);
    await writeJson(path.join(DIAGNOSTICS_DIR, 'run.json'), {
      generated_at: ACQUIRED_AT,
      rate_limit_ms: RATE_LIMIT_MS,
      api_page_size: PAGE_SIZE,
      max_retries: MAX_RETRIES,
      request_timeout_ms: REQUEST_TIMEOUT_MS,
      membership_count: membershipCount,
      canonical_work_count: canonicalWorks.length,
    });

    await browser.close();
    await promoteDirectory(OUTPUT_DIR, FINAL_DATA_DIR);
    await promoteDirectory(DIAGNOSTICS_DIR, FINAL_DIAGNOSTICS_DIR);
    console.log(`Promoted ${canonicalWorks.length} canonical works across ${discovery.tags.length} years.`);
  } finally {
    if (browser.isConnected()) await browser.close();
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
