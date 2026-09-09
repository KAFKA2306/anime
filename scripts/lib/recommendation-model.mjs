export const FACET_NAMES = ['source', 'genre', 'subgenre', 'setting', 'theme', 'motif', 'format'];
export const MODEL_VERSION = '1.0.0';
export const POPULARITY_WEIGHT = 0.05;

const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function classificationConfidence(work) {
  const status = String(work?.classification_status || '').toLowerCase();
  if (status === 'classified') return 1;
  if (status.includes('review')) return 0.6;
  if (status === 'unclassified' || status === 'unknown') return 0.5;
  return 0.75;
}

export function featuresFromWork(work) {
  const facets = work?.ontology_facets && typeof work.ontology_facets === 'object'
    ? work.ontology_facets
    : {};
  const features = [];

  for (const facet of FACET_NAMES) {
    const values = Array.isArray(facets[facet]) ? facets[facet] : [];
    for (const value of values) {
      const normalized = String(value || '').trim();
      if (normalized) features.push(`${facet}:${normalized}`);
    }
  }

  if (!features.some((feature) => feature.startsWith('source:')) && work?.source_origin) {
    features.push(`source:${String(work.source_origin).trim()}`);
  }

  return [...new Set(features)].sort((a, b) => a.localeCompare(b, 'ja'));
}

export function normalizeRating(rating, scale = { min: 1, neutral: 3, max: 5 }) {
  const value = Number(rating);
  if (!Number.isFinite(value)) throw new TypeError(`rating must be numeric: ${rating}`);
  const min = Number(scale.min);
  const neutral = Number(scale.neutral);
  const max = Number(scale.max);
  if (!(min < neutral && neutral < max)) throw new TypeError('rating_scale must satisfy min < neutral < max');
  if (value < min || value > max) throw new RangeError(`rating ${value} is outside ${min}..${max}`);
  if (value === neutral) return 0;
  return value > neutral
    ? (value - neutral) / (max - neutral)
    : (value - neutral) / (neutral - min);
}

export function buildPreferenceModel({ profile, works, source = {} }) {
  if (!profile?.profile_id) throw new TypeError('profile_id is required');
  if (!Array.isArray(profile.ratings)) throw new TypeError('ratings must be an array');

  const byId = new Map(works.map((work) => [String(work.work_id), work]));
  const scale = profile.rating_scale || { min: 1, neutral: 3, max: 5 };
  const stats = new Map();
  const missing_work_ids = [];
  const neutral_work_ids = [];
  const rated_work_ids = [];

  const ratings = [...profile.ratings]
    .map((entry) => ({ work_id: String(entry.work_id), rating: Number(entry.rating) }))
    .sort((a, b) => a.work_id.localeCompare(b.work_id));

  for (const entry of ratings) {
    const work = byId.get(entry.work_id);
    if (!work) {
      missing_work_ids.push(entry.work_id);
      continue;
    }
    rated_work_ids.push(entry.work_id);
    const signal = normalizeRating(entry.rating, scale);
    if (signal === 0) {
      neutral_work_ids.push(entry.work_id);
      continue;
    }

    const features = featuresFromWork(work);
    if (!features.length) continue;
    const confidence = classificationConfidence(work);
    const magnitude = Math.abs(signal) * confidence / Math.sqrt(features.length);

    for (const feature of features) {
      const current = stats.get(feature) || {
        feature,
        positive_mass: 0,
        negative_mass: 0,
        positive_support: 0,
        negative_support: 0,
      };
      if (signal > 0) {
        current.positive_mass += magnitude;
        current.positive_support += 1;
      } else {
        current.negative_mass += magnitude;
        current.negative_support += 1;
      }
      stats.set(feature, current);
    }
  }

  const weighted = [...stats.values()].map((entry) => {
    const support = entry.positive_support + entry.negative_support;
    const raw = entry.positive_mass - entry.negative_mass;
    const shrinkage = support / (support + 1);
    return { ...entry, support, shrunk_weight: raw * shrinkage };
  });
  const maxAbs = Math.max(1e-12, ...weighted.map((entry) => Math.abs(entry.shrunk_weight)));

  const features = weighted.map((entry) => ({
    feature: entry.feature,
    weight: round(entry.shrunk_weight / maxAbs),
    positive_support: entry.positive_support,
    negative_support: entry.negative_support,
    positive_mass: round(entry.positive_mass),
    negative_mass: round(entry.negative_mass),
  })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)
    || b.positive_support - a.positive_support
    || a.feature.localeCompare(b.feature, 'ja'));

  return {
    schema_version: '1.0.0',
    model_version: MODEL_VERSION,
    profile_id: profile.profile_id,
    rating_scale: scale,
    training: {
      requested_ratings: ratings.length,
      matched_ratings: rated_work_ids.length,
      rated_work_ids: rated_work_ids.sort(),
      neutral_work_ids: neutral_work_ids.sort(),
      missing_work_ids: missing_work_ids.sort(),
    },
    algorithm: {
      feature_space: FACET_NAMES,
      rating_signal: 'piecewise-linear around neutral',
      per_work_normalization: 'abs(signal) * classification_confidence / sqrt(feature_count)',
      feature_shrinkage: 'support / (support + 1)',
      feature_weight_normalization: 'max_abs',
      review_required_confidence: 0.6,
      popularity_weight: POPULARITY_WEIGHT,
    },
    source,
    features,
  };
}

export function scoreWorkWithModel(work, model, { maxPopularityLog = 1 } = {}) {
  const weights = new Map((model?.features || []).map((entry) => [entry.feature, Number(entry.weight) || 0]));
  const confidence = classificationConfidence(work);
  const features = featuresFromWork(work);
  const contributions = features.map((feature) => ({
    feature,
    weight: weights.get(feature) || 0,
    contribution: (weights.get(feature) || 0) * confidence,
  }));
  const rawAffinity = contributions.reduce((sum, entry) => sum + entry.contribution, 0)
    / Math.sqrt(Math.max(1, features.length));
  const preferenceScore = 0.5 + (0.5 * Math.tanh(rawAffinity * 1.5));
  const favoriteCount = Number(work?.favorite_count);
  const popularityNormalized = Number.isFinite(favoriteCount) && favoriteCount > 0
    ? Math.log1p(favoriteCount) / Math.max(1, maxPopularityLog)
    : 0;
  const popularityPrior = clamp(popularityNormalized, 0, 1) * POPULARITY_WEIGHT;
  const score = clamp(
    preferenceScore * (1 - POPULARITY_WEIGHT) + popularityPrior,
    0,
    1,
  );

  const positive = contributions
    .filter((entry) => entry.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution || a.feature.localeCompare(b.feature, 'ja'))
    .slice(0, 5)
    .map((entry) => ({ feature: entry.feature, contribution: round(entry.contribution) }));
  const negative = contributions
    .filter((entry) => entry.contribution < 0)
    .sort((a, b) => a.contribution - b.contribution || a.feature.localeCompare(b.feature, 'ja'))
    .slice(0, 5)
    .map((entry) => ({ feature: entry.feature, contribution: round(entry.contribution) }));

  return {
    work_id: String(work.work_id),
    score: round(score),
    preference_score: round(preferenceScore),
    popularity_prior: round(popularityPrior),
    classification_confidence: round(confidence),
    top_positive_features: positive,
    top_negative_features: negative,
  };
}

export function rankWorksForYear(works, model) {
  const rated = new Set(model?.training?.rated_work_ids || []);
  const maxPopularityLog = Math.max(1, ...works.map((work) => {
    const count = Number(work?.favorite_count);
    return Number.isFinite(count) && count > 0 ? Math.log1p(count) : 0;
  }));

  const scored = works
    .filter((work) => !rated.has(String(work.work_id)))
    .map((work) => ({
      ...scoreWorkWithModel(work, model, { maxPopularityLog }),
      classification_status: work.classification_status || null,
    }))
    .sort((a, b) => b.score - a.score || a.work_id.localeCompare(b.work_id));

  return scored.map((entry, index) => ({ ...entry, rank: index + 1 }));
}
