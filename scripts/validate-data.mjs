import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isExactOfficialListUrl, stableWorkContent } from './lib/official-api.mjs';

const DATA_DIR = path.resolve('data');

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function fail(message) {
  throw new Error(message);
}

function contentHash(works) {
  return createHash('sha256')
    .update(JSON.stringify(works.map(stableWorkContent)))
    .digest('hex');
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

async function readLikesTsv(year) {
  const text = await readFile(path.join(DATA_DIR, 'likes', `${year}.tsv`), 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines[0] !== 'work_id\ttitle\tfavorites_count') {
    fail(`${year} likes TSV has an invalid header.`);
  }

  const map = new Map();
  for (const line of lines.slice(1)) {
    const columns = line.split('\t');
    if (columns.length !== 3) fail(`${year} likes TSV has a malformed row.`);
    const [workId, title, countText] = columns;
    const count = Number(countText);
    if (!workId || !title || !Number.isInteger(count) || count < 0) {
      fail(`${year} likes TSV has an invalid row.`);
    }
    if (map.has(workId)) fail(`${year} likes TSV contains duplicate work_id ${workId}.`);
    map.set(workId, { title, count });
  }
  return map;
}

async function main() {
  const manifest = await readJson(path.join(DATA_DIR, 'manifest.json'));
  const works = await readJson(path.join(DATA_DIR, 'works.json'));
  const yearTags = await readJson(path.join(DATA_DIR, 'source', 'year-tags.json'));
  const yearFiles = (await readdir(path.join(DATA_DIR, 'by-year')))
    .filter((name) => /^\d{4}\.json$/.test(name))
    .sort();

  if (manifest.schema_version !== '2.0.0') {
    fail(`Unsupported manifest schema_version=${manifest.schema_version}.`);
  }
  if (manifest.year_count !== yearFiles.length || manifest.year_count !== yearTags.length) {
    fail('Manifest, source year tags, and generated year files have different year counts.');
  }
  if (!Array.isArray(works) || works.length === 0) fail('Canonical works.json is empty.');
  if (manifest.canonical_work_count !== works.length) {
    fail(`Manifest canonical_work_count=${manifest.canonical_work_count}, actual=${works.length}.`);
  }

  const canonicalIds = new Set();
  for (const work of works) {
    if (!work.work_id || !work.canonical_id || !work.title || !work.detail_url) {
      fail('Canonical work has a missing required field.');
    }
    if (!isNonNegativeInteger(work.favorite_count) || !isNonNegativeInteger(work.my_list_count)) {
      fail(`Canonical work ${work.work_id} has missing official counters.`);
    }
    if (canonicalIds.has(work.work_id)) fail(`Duplicate canonical work_id: ${work.work_id}`);
    canonicalIds.add(work.work_id);
    if (!Array.isArray(work.years) || work.years.length === 0) {
      fail(`Work ${work.work_id} has no year membership.`);
    }
  }

  let membershipCount = 0;
  const discoveredYears = [];
  for (const file of yearFiles) {
    const payload = await readJson(path.join(DATA_DIR, 'by-year', file));
    discoveredYears.push(payload.year);
    if (payload.schema_version !== '2.0.0') fail(`${file} has an unsupported schema version.`);
    if (!Array.isArray(payload.works) || payload.works.length === 0) {
      fail(`${file} contains no works.`);
    }
    if (payload.count !== payload.works.length) fail(`${file} count does not match works length.`);
    if (payload.declared_count !== payload.count) {
      fail(`${file} official maxCount=${payload.declared_count}, canonical count=${payload.count}.`);
    }
    if (payload.official_json_count !== payload.count) {
      fail(`${file} official JSON count=${payload.official_json_count}, canonical count=${payload.count}.`);
    }
    if (payload.content_sha256 !== contentHash(payload.works)) {
      fail(`${file} content_sha256 does not match stable official content.`);
    }

    const stats = manifest.acquisition?.[String(payload.year)];
    if (!stats || stats.transport !== 'direct-official-json' ||
        stats.work_count !== payload.count ||
        stats.declared_work_count !== payload.count ||
        stats.official_json_work_count !== payload.count ||
        stats.content_sha256 !== payload.content_sha256) {
      fail(`${file} disagrees with manifest acquisition statistics.`);
    }

    const likes = await readLikesTsv(payload.year);
    if (likes.size !== payload.works.length) {
      fail(`${file} and data/likes/${payload.year}.tsv have different row counts.`);
    }

    const ids = new Set();
    for (const work of payload.works) {
      if (!work.work_id || !work.title || !work.detail_url) {
        fail(`${file} has a work with missing required fields.`);
      }
      if (work.year !== payload.year) fail(`${file} contains mismatched year ${work.year}.`);
      if (work.source_tag_id !== payload.source_tag_id) {
        fail(`${file} work ${work.work_id} has a mismatched source tag.`);
      }
      if (work.title_source !== 'official-json' || work.count_source !== 'official-json') {
        fail(`${file} work ${work.work_id} is not fully sourced from official JSON.`);
      }
      if (!isExactOfficialListUrl(work.title_source_url, payload.source_tag_id) ||
          !isExactOfficialListUrl(work.count_source_url, payload.source_tag_id)) {
        fail(`${file} work ${work.work_id} has invalid official provenance URLs.`);
      }
      if (!Array.isArray(work.extraction_sources) ||
          !work.extraction_sources.includes('official-json')) {
        fail(`${file} work ${work.work_id} lacks official JSON extraction evidence.`);
      }
      if (!isNonNegativeInteger(work.favorite_count) || !isNonNegativeInteger(work.my_list_count)) {
        fail(`${file} work ${work.work_id} has missing official counters.`);
      }

      const exported = likes.get(work.work_id);
      if (!exported || exported.title !== work.title || exported.count !== work.favorite_count) {
        fail(`${file} work ${work.work_id} disagrees with the generated likes TSV.`);
      }
      if (ids.has(work.work_id)) fail(`${file} contains duplicate work_id ${work.work_id}.`);
      if (!canonicalIds.has(work.work_id)) {
        fail(`${file} contains work_id absent from canonical works.json: ${work.work_id}`);
      }
      ids.add(work.work_id);
    }
    membershipCount += payload.works.length;
  }

  if (membershipCount !== manifest.membership_count) {
    fail(`Manifest membership_count=${manifest.membership_count}, actual=${membershipCount}.`);
  }
  if (JSON.stringify(discoveredYears) !== JSON.stringify(manifest.discovered_years)) {
    fail('Manifest discovered_years does not match year files.');
  }
  if (JSON.stringify(discoveredYears) !== JSON.stringify(yearTags.map((tag) => tag.year))) {
    fail('Source year tags do not match generated year files.');
  }

  const integrity = manifest.integrity ?? {};
  for (const field of [
    'duplicate_work_ids_within_year',
    'missing_titles',
    'empty_years',
    'official_count_mismatches',
    'non_official_titles',
    'missing_official_favorite_counts',
    'missing_official_my_list_counts',
  ]) {
    if (integrity[field] !== 0) fail(`Manifest integrity field ${field} is not zero.`);
  }

  console.log(
    `Validated ${works.length} canonical works across ${yearFiles.length} years ` +
      `(${membershipCount} memberships), including official favorite and my-list counts.`,
  );
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
