import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOfficialListUrl,
  isExactOfficialListUrl,
  parseOfficialListDocument,
  stableWorkContent,
} from '../scripts/lib/official-api.mjs';

const tagId = 'T0019675';
const sourceUrl = `https://animestore.docomo.ne.jp/animestore/rest/WS000106?length=20&mainKeyVisualSize=2&tagId=${tagId}&_=1`;
const fixture = {
  resultCd: '00',
  selfLink: sourceUrl,
  data: {
    maxCount: 1,
    count: 1,
    workList: [{
      workId: '27198',
      workInfo: {
        workTitle: '時々ボソッとロシア語でデレる隣のアーリャさん',
        link: '/animestore/ci_pc?workId=27198',
        mainKeyVisualPath: '/anime/example.png',
        mainKeyVisualAlt: '時々ボソッとロシア語でデレる隣のアーリャさん_2',
        workIcons: [],
        myListCount: 125933,
        favoriteCount: 142588,
        workTypeList: ['anime'],
        vodType: 'svod',
        ageLimitType: '0',
      },
      seriesInfo: null,
    }],
  },
};

test('builds the exact official year-list endpoint', () => {
  const url = buildOfficialListUrl({ tagId, start: 20, length: 20, cacheBust: 123 });
  const parsed = new URL(url);
  assert.equal(parsed.pathname, '/animestore/rest/WS000106');
  assert.equal(parsed.searchParams.get('tagId'), tagId);
  assert.equal(parsed.searchParams.get('start'), '20');
  assert.equal(parsed.searchParams.get('length'), '20');
  assert.equal(isExactOfficialListUrl(url, tagId), true);
  assert.equal(isExactOfficialListUrl(url, 'T0021150'), false);
});

test('parses official titles and official favorite counters without DOM inference', () => {
  const result = parseOfficialListDocument(fixture, { expectedTagId: tagId, requestUrl: sourceUrl });
  assert.equal(result.maxCount, 1);
  assert.equal(result.works[0].work_id, '27198');
  assert.equal(result.works[0].title, '時々ボソッとロシア語でデレる隣のアーリャさん');
  assert.equal(result.works[0].favorite_count, 142588);
  assert.equal(result.works[0].my_list_count, 125933);
  assert.equal(result.works[0].count_source, 'official-json');
});

test('rejects mismatched tags, malformed counts, and truncated pages', () => {
  assert.throws(
    () => parseOfficialListDocument(fixture, { expectedTagId: 'T0021150', requestUrl: sourceUrl }),
    /exact tag/,
  );

  const missingCount = structuredClone(fixture);
  delete missingCount.data.workList[0].workInfo.favoriteCount;
  assert.throws(
    () => parseOfficialListDocument(missingCount, { expectedTagId: tagId, requestUrl: sourceUrl }),
    /favoriteCount/,
  );

  const truncated = structuredClone(fixture);
  truncated.data.count = 2;
  assert.throws(
    () => parseOfficialListDocument(truncated, { expectedTagId: tagId, requestUrl: sourceUrl }),
    /workList.length/,
  );
});

test('stable hash content excludes volatile acquisition URLs', () => {
  const result = parseOfficialListDocument(fixture, { expectedTagId: tagId, requestUrl: sourceUrl });
  const stable = stableWorkContent({
    ...result.works[0],
    acquired_at: '2026-07-22T00:00:00Z',
    title_source_url: `${sourceUrl}999`,
  });
  assert.deepEqual(Object.keys(stable), [
    'work_id',
    'title',
    'detail_url',
    'image_url',
    'favorite_count',
    'my_list_count',
    'work_type_list',
    'work_icons',
    'vod_type',
    'age_limit_type',
  ]);
});
