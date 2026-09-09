import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankWorksForYear } from './lib/recommendation-model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

const yearDir = path.join(ROOT, 'data', 'by-year');
const yearFiles = fs.readdirSync(yearDir)
  .filter((name) => /^\d{4}\.json$/.test(name))
  .sort();
const recommendationsRoot = path.join(ROOT, 'data', 'recommendations');
const profileIds = fs.existsSync(recommendationsRoot)
  ? fs.readdirSync(recommendationsRoot)
    .filter((name) => fs.existsSync(path.join(recommendationsRoot, name, 'model.json')))
    .sort()
  : [];

if (!profileIds.length) throw new Error('No built preference models found. Run preference:model first.');

for (const profileId of profileIds) {
  const model = readJson(path.join(recommendationsRoot, profileId, 'model.json'));
  const profileManifest = [];
  for (const yearFile of yearFiles) {
    const payload = readJson(path.join(yearDir, yearFile));
    const recommendations = rankWorksForYear(payload.works || [], model);
    const year = Number(payload.year || yearFile.slice(0, 4));
    const output = {
      schema_version: '1.0.0',
      profile_id: profileId,
      model_version: model.model_version,
      year,
      source: {
        source_tag_id: payload.source_tag_id || null,
        source_url: payload.source_url || null,
        source_generated_at: payload.generated_at || null,
        source_content_sha256: payload.content_sha256 || null,
        model_manifest_sha256: model.source?.manifest_sha256 || null,
        model_profile_sha256: model.source?.profile_sha256 || null,
      },
      training: {
        matched_ratings: model.training?.matched_ratings || 0,
        missing_work_ids: model.training?.missing_work_ids || [],
      },
      recommendation_count: recommendations.length,
      recommendations,
    };
    writeJson(path.join(recommendationsRoot, profileId, `${year}.json`), output);
    profileManifest.push({ year, recommendation_count: recommendations.length, source_content_sha256: payload.content_sha256 || null });
  }
  writeJson(path.join(recommendationsRoot, profileId, 'manifest.json'), {
    schema_version: '1.0.0',
    profile_id: profileId,
    model_version: model.model_version,
    source: model.source,
    years: profileManifest.sort((a, b) => a.year - b.year),
  });
  console.log(`Built recommendations: ${profileId} (${profileManifest.length} years)`);
}
