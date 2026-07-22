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
  const yearFiles = (await readdir(path.join(DATA_DIR, 'by-year')))
    .filter((name) => /^\d{4}\.json$/.test(name))
    .sort();

  if (manifest.year_count !== yearFiles.length) {
    fail(`Manifest year_count=${manifest.year_count}, but ${yearFiles.length} year files exist.`);
  }
  if (!Array.isArray(works) || works.length === 0) fail('Canonical works.json is empty.');
  if (manifest.canonical_work_count !== works.length) {
    fail(`Manifest canonical_work_count=${manifest.canonical_work_count}, actual=${works.length}.`);
  }

  const canonicalIds = new Set();
  for (const work of works) {
    if (!work.work_id || !work.canonical_id || !work.title) fail('Canonical work has a missing required field.');
    if (canonicalIds.has(work.work_id)) fail(`Duplicate canonical work_id: ${work.work_id}`);
    canonicalIds.add(work.work_id);
    if (!Array.isArray(work.years) || work.years.length === 0) fail(`Work ${work.work_id} has no year membership.`);
  }

  let membershipCount = 0;
  const discoveredYears = [];
  for (const file of yearFiles) {
    const payload = await readJson(path.join(DATA_DIR, 'by-year', file));
    discoveredYears.push(payload.year);
    if (!Array.isArray(payload.works) || payload.works.length === 0) fail(`${file} contains no works.`);
    if (payload.count !== payload.works.length) fail(`${file} count does not match works length.`);

    const ids = new Set();
    for (const work of payload.works) {
      if (!work.work_id || !work.title || !work.detail_url) fail(`${file} has a work with missing required fields.`);
      if (work.year !== payload.year) fail(`${file} contains mismatched year ${work.year}.`);
      if (ids.has(work.work_id)) fail(`${file} contains duplicate work_id ${work.work_id}.`);
      if (!canonicalIds.has(work.work_id)) fail(`${file} contains work_id absent from canonical works.json: ${work.work_id}`);
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

  console.log(`Validated ${works.length} canonical works across ${yearFiles.length} years (${membershipCount} memberships).`);
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
