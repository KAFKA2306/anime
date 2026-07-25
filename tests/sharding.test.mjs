import test from 'node:test';
import assert from 'node:assert/strict';
import { parseShardConfig, selectShard, stableShardIndex } from '../scripts/lib/sharding.mjs';

test('default shard config selects the full catalogue', () => {
  assert.deepEqual(parseShardConfig({}), { count: 1, index: 0 });
});

test('invalid partial shard config is rejected', () => {
  assert.throws(() => parseShardConfig({ DANIME_ENRICH_SHARD_COUNT: '4' }), /set together/);
  assert.throws(() => parseShardConfig({
    DANIME_ENRICH_SHARD_COUNT: '4',
    DANIME_ENRICH_SHARD_INDEX: '4',
  }), /zero-based/);
});

test('stable shard assignment is deterministic and exhaustive', () => {
  const items = Array.from({ length: 100 }, (_, index) => ({ work_id: `W${index}` }));
  const assigned = new Map();
  for (let index = 0; index < 8; index += 1) {
    for (const item of selectShard(items, { count: 8, index })) {
      assert.equal(stableShardIndex(item.work_id, 8), index);
      assert.equal(assigned.has(item.work_id), false);
      assigned.set(item.work_id, index);
    }
  }
  assert.equal(assigned.size, items.length);
});
