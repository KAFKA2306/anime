import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve('data');

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function fail(message) {
  throw new Error(message);
}

async function main() {
  const manifest = await readJson(path.join(DATA_DIR, 'manifest.json'));
  const works = await readJson(path.join(DATA_DIR, 'works.json'));
  const yearTags = await readJson(path.join(DATA_DIR, 'source', 'year-tags.json'));
  const yearFiles = (await readdir(path.join(DATA_DIR, 'by-year')))
    .filter((name) => /^\d{4}\.json$/.test(name))
    .sort();

  if (manifest.year_count !== yearFiles.length || manifest.year_count !== yearTags.length) {
    fail('Manifest, source year tags, and generated year files have different year counts.');
  }
  if (!Array.isArray(works) || works.length === 0) fail('Canonical works.json is empty.');
  if (manifest.canonical_work_count !== works.length) {
    fail(`Manifest canonical_work_count=${manifest.canonical_work_count}, actual=${works.length}.`);
  }

  const canonicalIds = new Set();
  for (const work of works) {
    if (!work.work_id || !work.canonical_id || !work.title) {
      fail('Canonical work has a missing required field.');
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

    const stats = manifest.acquisition?.[String(payload.year)];
    if (!stats || stats.work_count !== payload.count ||
        stats.declared_work_count !== payload.count ||
        stats.official_json_work_count !== payload.count) {
      fail(`${file} disagrees with manifest acquisition statistics.`);
    }

    const ids = new Set();
    for (const work of payload.works) {
      if (!work.work_id || !work.title || !work.detail_url) {
        fail(`${file} has a work with missing required fields.`);
      }
      if (work.year !== payload.year) fail(`${file} contains mismatched year ${work.year}.`);
      if (work.title_source !== 'official-json') {
        fail(`${file} work ${work.work_id} title is not sourced from official JSON.`);
      }
      if (!Array.isArray(work.extraction_sources) ||
          !work.extraction_sources.includes('official-json')) {
        fail(`${file} work ${work.work_id} lacks official JSON extraction evidence.`);
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
  ]) {
    if (integrity[field] !== 0) fail(`Manifest integrity field ${field} is not zero.`);
  }

  console.log(
    `Validated ${works.length} canonical works across ${yearFiles.length} years ` +
      `(${membershipCount} memberships), all matched to official JSON maxCount.`,
  );
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
