import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  mergeCanonical,
  sanitizeTitle,
  workIdFromUrl,
} from './lib/catalog.mjs';

const DATA_DIR = path.resolve('data');
const NETWORK_DIR = path.resolve('diagnostics', 'network');

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function fail(message) {
  throw new Error(message);
}

function exactTagResponse(document, expectedTagId) {
  const selfLink = document?.selfLink;
  if (!selfLink) return false;
  try {
    const url = new URL(selfLink);
    return url.pathname.endsWith('/rest/WS000106') &&
      url.searchParams.get('tagId') === expectedTagId;
  } catch {
    return false;
  }
}

function extractOfficialWork(item, sourceUrl) {
  const info = item?.workInfo ?? item ?? {};
  const workId = String(
    item?.workId ?? info.workId ?? workIdFromUrl(info.link ?? info.url) ?? '',
  );
  const title = sanitizeTitle(info.workTitle ?? info.workName ?? info.title ?? null);
  if (!workId || !title) return null;

  return {
    work_id: workId,
    title,
    detail_url: info.link ?? info.url ?? null,
    image_url: info.mainKeyVisualPath ?? info.imageUrl ?? null,
    title_source_url: sourceUrl,
  };
}

async function officialWorksForYear(yearPayload, networkFiles) {
  const works = new Map();
  const declaredCounts = new Set();
  let responseCount = 0;

  for (const filename of networkFiles) {
    if (!filename.startsWith(`${yearPayload.year}-`) || !filename.endsWith('.json')) continue;
    const document = await readJson(path.join(NETWORK_DIR, filename));
    if (!exactTagResponse(document, yearPayload.source_tag_id)) continue;

    responseCount += 1;
    const maxCount = document?.data?.maxCount;
    if (Number.isInteger(maxCount)) declaredCounts.add(maxCount);

    const sourceUrl = document.selfLink;
    for (const item of document?.data?.workList ?? []) {
      const work = extractOfficialWork(item, sourceUrl);
      if (!work) continue;
      const current = works.get(work.work_id);
      if (current && current.title !== work.title) {
        fail(`${yearPayload.year}: conflicting official titles for work ${work.work_id}.`);
      }
      works.set(work.work_id, work);
    }
  }

  if (responseCount === 0) {
    fail(`${yearPayload.year}: no exact-tag WS000106 responses were captured.`);
  }
  if (declaredCounts.size !== 1) {
    fail(`${yearPayload.year}: official maxCount is missing or inconsistent.`);
  }

  const declaredCount = [...declaredCounts][0];
  if (works.size !== declaredCount) {
    fail(
      `${yearPayload.year}: captured ${works.size} unique official works, ` +
      `but maxCount=${declaredCount}.`,
    );
  }

  return { works, declaredCount, responseCount };
}

async function main() {
  const manifestPath = path.join(DATA_DIR, 'manifest.json');
  const manifest = await readJson(manifestPath);
  const yearFiles = (await readdir(path.join(DATA_DIR, 'by-year')))
    .filter((name) => /^\d{4}\.json$/.test(name))
    .sort();
  const networkFiles = await readdir(NETWORK_DIR);
  const byYear = {};

  for (const filename of yearFiles) {
    const file = path.join(DATA_DIR, 'by-year', filename);
    const payload = await readJson(file);
    const official = await officialWorksForYear(payload, networkFiles);
    const existingIds = new Set(payload.works.map((work) => work.work_id));

    if (existingIds.size !== official.works.size ||
        [...existingIds].some((workId) => !official.works.has(workId))) {
      fail(`${payload.year}: DOM set and complete official JSON set do not match.`);
    }

    payload.works = payload.works
      .map((work) => {
        const source = official.works.get(work.work_id);
        const extractionSources = new Set([
          ...(work.extraction_sources ?? []),
          work.extraction_method,
          'official-json',
        ].filter(Boolean));
        return {
          ...work,
          title: source.title,
          detail_url: source.detail_url ?? work.detail_url,
          image_url: source.image_url ?? work.image_url,
          title_source: 'official-json',
          title_source_url: source.title_source_url,
          extraction_sources: [...extractionSources].sort(),
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title, 'ja'));

    payload.declared_count = official.declaredCount;
    payload.official_json_count = official.works.size;
    payload.count = payload.works.length;
    byYear[payload.year] = payload.works;

    const stats = manifest.acquisition[String(payload.year)];
    stats.declared_work_count = official.declaredCount;
    stats.official_json_work_count = official.works.size;
    stats.official_json_response_count = official.responseCount;
    stats.work_count = payload.works.length;

    await writeJson(file, payload);
  }

  const canonicalWorks = mergeCanonical(byYear);
  manifest.canonical_work_count = canonicalWorks.length;
  manifest.membership_count = Object.values(byYear)
    .reduce((sum, works) => sum + works.length, 0);
  manifest.integrity = {
    duplicate_work_ids_within_year: 0,
    missing_titles: 0,
    empty_years: 0,
    official_count_mismatches: 0,
    non_official_titles: 0,
  };

  await writeJson(path.join(DATA_DIR, 'works.json'), canonicalWorks);
  await writeJson(manifestPath, manifest);

  console.log(
    `Canonicalized ${canonicalWorks.length} works from complete official JSON title data.`,
  );
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
