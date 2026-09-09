import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { featuresFromWork } from './lib/recommendation-model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const recRoot = path.join(ROOT, 'data', 'recommendations');

for (const profileId of fs.readdirSync(recRoot).sort()) {
  const profileDir = path.join(recRoot, profileId);
  const modelPath = path.join(profileDir, 'model.json');
  if (!fs.existsSync(modelPath)) continue;
  const model = readJson(modelPath);
  const rated = new Set(model.training?.rated_work_ids || []);
  if (!model.features?.length) throw new Error(`${profileId}: model has no learned features`);
  if (model.title_overrides || model.overrides) throw new Error(`${profileId}: title-specific overrides are forbidden`);

  for (const file of fs.readdirSync(profileDir).filter((name) => /^\d{4}\.json$/.test(name)).sort()) {
    const yearPayload = readJson(path.join(profileDir, file));
    const canonical = readJson(path.join(ROOT, 'data', 'by-year', file));
    const byId = new Map((canonical.works || []).map((work) => [String(work.work_id), work]));
    let previousScore = Infinity;
    for (const [index, entry] of (yearPayload.recommendations || []).entries()) {
      if (entry.rank !== index + 1) throw new Error(`${profileId}/${file}: non-consecutive rank at ${entry.work_id}`);
      if (entry.score > previousScore + 1e-12) throw new Error(`${profileId}/${file}: recommendations are not score-sorted`);
      previousScore = entry.score;
      if (entry.score < 0 || entry.score > 1) throw new Error(`${profileId}/${file}: score out of range`);
      if (rated.has(String(entry.work_id))) throw new Error(`${profileId}/${file}: rated work leaked into recommendations`);
      const work = byId.get(String(entry.work_id));
      if (!work) throw new Error(`${profileId}/${file}: unknown work_id ${entry.work_id}`);
      const actual = new Set(featuresFromWork(work));
      for (const reason of [...(entry.top_positive_features || []), ...(entry.top_negative_features || [])]) {
        if (!actual.has(reason.feature)) throw new Error(`${profileId}/${file}: reason ${reason.feature} lacks facet provenance`);
      }
    }
  }
  console.log(`Verified recommendations: ${profileId}`);
}
