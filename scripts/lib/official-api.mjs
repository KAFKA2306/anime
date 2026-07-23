import { OFFICIAL_ORIGIN, sanitizeTitle, tagIdFromUrl, workIdFromUrl } from './catalog.mjs';

export const OFFICIAL_LIST_PATH = '/animestore/rest/WS000106';

export function buildOfficialListUrl({ tagId, start = 0, length = 20, cacheBust = Date.now() }) {
  if (!/^T\d{7}$/.test(String(tagId))) throw new Error(`Invalid official tag ID: ${tagId}`);
  if (!Number.isInteger(start) || start < 0) throw new Error(`Invalid start offset: ${start}`);
  if (!Number.isInteger(length) || length < 1 || length > 100) {
    throw new Error(`Invalid page length: ${length}`);
  }

  const url = new URL(OFFICIAL_LIST_PATH, OFFICIAL_ORIGIN);
  if (start > 0) url.searchParams.set('start', String(start));
  url.searchParams.set('length', String(length));
  url.searchParams.set('mainKeyVisualSize', '2');
  url.searchParams.set('tagId', tagId);
  url.searchParams.set('_', String(cacheBust));
  return url.toString();
}

export function canonicalOfficialListUrl(value) {
  const url = new URL(value, OFFICIAL_ORIGIN);
  url.searchParams.delete('_');
  url.hash = '';
  return url.toString();
}

export function isExactOfficialListUrl(value, expectedTagId) {
  try {
    const url = new URL(value, OFFICIAL_ORIGIN);
    return url.origin === OFFICIAL_ORIGIN
      && url.pathname === OFFICIAL_LIST_PATH
      && tagIdFromUrl(url) === expectedTagId;
  } catch {
    return false;
  }
}

function nonNegativeInteger(value, field, context) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${context}: ${field} must be a non-negative integer.`);
  }
  return value;
}

function optionalStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function absoluteUrl(value) {
  try {
    return value ? new URL(value, OFFICIAL_ORIGIN).toString() : null;
  } catch {
    return null;
  }
}

export function extractOfficialWork(item, sourceUrl) {
  const info = item?.workInfo ?? {};
  const workId = String(item?.workId ?? info.workId ?? workIdFromUrl(info.link ?? info.url) ?? '');
  const title = sanitizeTitle(info.workTitle ?? info.workName ?? info.title ?? null);
  if (!workId || !/^[A-Za-z0-9_-]+$/.test(workId) || !title) return null;

  const favoriteCount = nonNegativeInteger(
    info.favoriteCount,
    'workInfo.favoriteCount',
    `work ${workId}`,
  );
  const myListCount = nonNegativeInteger(
    info.myListCount,
    'workInfo.myListCount',
    `work ${workId}`,
  );

  return {
    work_id: workId,
    title,
    detail_url: absoluteUrl(info.link ?? info.url)
      ?? `${OFFICIAL_ORIGIN}/animestore/ci_pc?workId=${encodeURIComponent(workId)}`,
    image_url: absoluteUrl(info.mainKeyVisualPath ?? info.imageUrl ?? null),
    favorite_count: favoriteCount,
    my_list_count: myListCount,
    work_type_list: optionalStringArray(info.workTypeList),
    work_icons: optionalStringArray(info.workIcons),
    vod_type: info.vodType == null ? null : String(info.vodType),
    age_limit_type: info.ageLimitType == null ? null : String(info.ageLimitType),
    extraction_method: 'official-json-direct',
    extraction_source_url: sourceUrl,
    title_source: 'official-json',
    title_source_url: sourceUrl,
    count_source: 'official-json',
    count_source_url: sourceUrl,
    extraction_sources: ['official-json'],
  };
}

export function parseOfficialListDocument(document, { expectedTagId, requestUrl }) {
  const context = `official list ${expectedTagId}`;
  if (!document || typeof document !== 'object') {
    throw new Error(`${context}: response is not a JSON object.`);
  }
  if (String(document.resultCd ?? '') !== '00') {
    throw new Error(`${context}: resultCd=${document.resultCd ?? 'missing'}.`);
  }

  const rawSourceUrl = document.selfLink ?? requestUrl;
  if (!isExactOfficialListUrl(rawSourceUrl, expectedTagId)) {
    throw new Error(`${context}: selfLink does not match the requested exact tag.`);
  }
  const sourceUrl = canonicalOfficialListUrl(rawSourceUrl);

  const data = document.data;
  if (!data || typeof data !== 'object') throw new Error(`${context}: data is missing.`);
  const maxCount = nonNegativeInteger(data.maxCount, 'data.maxCount', context);
  const count = nonNegativeInteger(data.count, 'data.count', context);
  if (!Array.isArray(data.workList)) throw new Error(`${context}: data.workList is not an array.`);
  if (count !== data.workList.length) {
    throw new Error(`${context}: data.count=${count}, workList.length=${data.workList.length}.`);
  }

  const works = data.workList.map((item) => extractOfficialWork(item, sourceUrl));
  if (works.some((work) => work === null)) {
    throw new Error(`${context}: a work record is missing a valid ID, title, or count.`);
  }

  return {
    sourceUrl,
    maxCount,
    count,
    works,
  };
}

export function stableWorkContent(work) {
  return {
    work_id: work.work_id,
    title: work.title,
    detail_url: work.detail_url,
    image_url: work.image_url ?? null,
    favorite_count: work.favorite_count,
    my_list_count: work.my_list_count,
    work_type_list: work.work_type_list ?? [],
    work_icons: work.work_icons ?? [],
    vod_type: work.vod_type ?? null,
    age_limit_type: work.age_limit_type ?? null,
  };
}
