import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve('data');

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  if (process.env.DANIME_YEAR) {
    console.log('Single-year diagnostic mode: generated snapshot stabilization skipped.');
    return;
  }

  const filenames = (await readdir(path.join(DATA_DIR, 'by-year')))
    .filter((name) => /^\d{4}\.json$/.test(name));
  let removed = 0;

  for (const filename of filenames) {
    const file = path.join(DATA_DIR, 'by-year', filename);
    const payload = await readJson(file);
    for (const work of payload.works ?? []) {
      if (Object.hasOwn(work, 'acquired_at')) {
        delete work.acquired_at;
        removed += 1;
      }
    }
    await writeJson(file, payload);
  }

  console.log(`Removed ${removed} volatile per-work acquisition timestamps.`);
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
