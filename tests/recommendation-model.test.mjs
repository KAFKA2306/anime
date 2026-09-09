import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreferenceModel, rankWorksForYear, scoreWorkWithModel } from '../scripts/lib/recommendation-model.mjs';

const work = (id, facets, extra={}) => ({
  work_id: String(id),
  favorite_count: 100,
  classification_status: 'classified',
  ontology_facets: { source: [], genre: [], subgenre: [], setting: [], theme: [], motif: [], format: [], ...facets },
  ...extra,
});

const liked = work('1', { theme:['職業・仕事','推理・謎解き'], genre:['ドラマ・青春'] });
const disliked = work('2', { genre:['異世界・ハイファンタジー'], setting:['異世界'], motif:['転生'] });
const candidate = work('3', { theme:['職業・仕事','推理・謎解き'], genre:['ドラマ・青春'] }, {favorite_count:10});
const badPopular = work('4', { genre:['異世界・ハイファンタジー'], setting:['異世界'], motif:['転生'] }, {favorite_count:9999999});

const profile = { profile_id:'test', rating_scale:{min:1,neutral:3,max:5}, ratings:[{work_id:'1',rating:5},{work_id:'2',rating:1}] };

test('rating order does not change learned model', () => {
  const a = buildPreferenceModel({profile,works:[liked,disliked]});
  const b = buildPreferenceModel({profile:{...profile,ratings:[...profile.ratings].reverse()},works:[liked,disliked]});
  assert.deepEqual(a,b);
});

test('new unseen work is scored from facets without title logic', () => {
  const model = buildPreferenceModel({profile,works:[liked,disliked]});
  const ranked = rankWorksForYear([candidate,badPopular],model);
  assert.equal(ranked[0].work_id,'3');
  assert.ok(ranked[0].score > ranked[1].score);
});

test('changing title alone does not change score', () => {
  const model = buildPreferenceModel({profile,works:[liked,disliked]});
  const a = scoreWorkWithModel({...candidate,title:'A'},model,{maxPopularityLog:10});
  const b = scoreWorkWithModel({...candidate,title:'Totally different'},model,{maxPopularityLog:10});
  assert.deepEqual(a,b);
});

test('popularity prior cannot overpower strong negative affinity', () => {
  const model = buildPreferenceModel({profile,works:[liked,disliked]});
  const ranked = rankWorksForYear([candidate,badPopular],model);
  assert.ok(ranked.find(x=>x.work_id==='3').score > ranked.find(x=>x.work_id==='4').score);
});

test('review-required candidate is confidence-reduced', () => {
  const model = buildPreferenceModel({profile,works:[liked,disliked]});
  const classified = scoreWorkWithModel(candidate,model,{maxPopularityLog:10});
  const review = scoreWorkWithModel({...candidate,classification_status:'needs-review'},model,{maxPopularityLog:10});
  assert.ok(classified.preference_score > review.preference_score);
});

test('recommendation reasons trace to actual ontology features', () => {
  const model = buildPreferenceModel({profile,works:[liked,disliked]});
  const scored = scoreWorkWithModel(candidate,model,{maxPopularityLog:10});
  const actual = new Set(['theme:職業・仕事','theme:推理・謎解き','genre:ドラマ・青春']);
  assert.ok(scored.top_positive_features.length > 0);
  for (const reason of scored.top_positive_features) assert.ok(actual.has(reason.feature));
});
