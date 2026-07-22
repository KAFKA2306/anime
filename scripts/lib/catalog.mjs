export const OFFICIAL_ORIGIN = 'https://animestore.docomo.ne.jp';
export const TAG_SELECTOR_URL = `${OFFICIAL_ORIGIN}/animestore/tag_sel_pc`;

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function parseYear(value) {
  const match = normalizeText(value).match(/(?:^|\D)((?:19|20)\d{2})年(?!代)(?:アニメ)?(?:$|\D)/);
  return match ? Number(match[1]) : null;
}

export function workIdFromUrl(value) {
  try {
    const url = new URL(value, OFFICIAL_ORIGIN);
    const id = url.searchParams.get('workId');
    return id && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function tagIdFromUrl(value) {
  try {
    const url = new URL(value, OFFICIAL_ORIGIN);
    const id = url.searchParams.get('tagId');
    return id && /^T\d{7}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function sanitizeTitle(value) {
  const text = normalizeText(value)
    .replace(/^(?:気になる|作品詳細|詳細)\s*/u, '')
    .replace(/\s*(?:気になる|作品詳細|詳細)$/u, '')
    .trim();

  if (!text || text.length > 240) return null;
  if (/^(?:ホーム|ログイン|メニュー|すべて見る|次へ|前へ|見放題|レンタル)$/u.test(text)) {
    return null;
  }
  return text;
}

export function mergeCanonical(byYear) {
  const map = new Map();

  for (const [yearKey, works] of Object.entries(byYear)) {
    const year = Number(yearKey);
    for (const work of works) {
      const current = map.get(work.work_id) ?? {
        canonical_id: `danime:${work.work_id}`,
        work_id: work.work_id,
        title: work.title,
        title_aliases: [],
        years: [],
        detail_url: work.detail_url,
        image_url: work.image_url ?? null,
        favorite_count: work.favorite_count ?? null,
        my_list_count: work.my_list_count ?? null,
        work_type_list: work.work_type_list ?? [],
        vod_type: work.vod_type ?? null,
        age_limit_type: work.age_limit_type ?? null,
        source: 'dアニメストア',
      };

      if (!current.years.includes(year)) current.years.push(year);
      if (work.title && work.title !== current.title && !current.title_aliases.includes(work.title)) {
        current.title_aliases.push(work.title);
      }
      if (!current.image_url && work.image_url) current.image_url = work.image_url;
      if (Number.isInteger(work.favorite_count)) {
        current.favorite_count = current.favorite_count == null
          ? work.favorite_count
          : Math.max(current.favorite_count, work.favorite_count);
      }
      if (Number.isInteger(work.my_list_count)) {
        current.my_list_count = current.my_list_count == null
          ? work.my_list_count
          : Math.max(current.my_list_count, work.my_list_count);
      }
      map.set(work.work_id, current);
    }
  }

  return [...map.values()]
    .map((work) => ({
      ...work,
      years: work.years.sort((a, b) => a - b),
      title_aliases: work.title_aliases.sort((a, b) => a.localeCompare(b, 'ja')),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, 'ja'));
}
