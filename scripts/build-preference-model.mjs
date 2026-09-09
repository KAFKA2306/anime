import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildPreferenceModel } from './lib/recommendation-model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

function loadCatalog() {
  const dir = path.join(ROOT, 'data', 'by-year');
  const files = fs.readdirSync(dir)
    .filter((name) => /^\d{4}\.json$/.test(name))
    .sort();
  const works = [];
  for (const name of files) {
    const payload = readJson(path.join(dir, name));
    for (const work of payload.works || []) works.push(work);
  }
  return works;
}

const manifestPath = path.join(ROOT, 'data', 'manifest.json');
const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestRaw);
const works = loadCatalog();
const preferencesDir = path.join(ROOT, 'preferences');
const profileFiles = fs.readdirSync(preferencesDir)
  .filter((name) => name.endsWith('.json'))
  .sort();

if (!profileFiles.length) throw new Error('No preference profiles found.');

for (const name of profileFiles) {
  const profilePath = path.join(preferencesDir, name);
  const profileRaw = fs.readFileSync(profilePath, 'utf8');
  const profile = JSON.parse(profileRaw);
  const model = buildPreferenceModel({
    profile,
    works,
    source: {
      manifest_generated_at: manifest.generated_at || null,
      manifest_sha256: sha256(manifestRaw),
      profile_sha256: sha256(profileRaw),
      catalog_work_count: works.length,
    },
  });
  writeJson(path.join(ROOT, 'data', 'recommendations', profile.profile_id, 'model.json'), model);
  console.log(`Built preference model: ${profile.profile_id} (${model.training.matched_ratings}/${model.training.requested_ratings} ratings)`);
}
