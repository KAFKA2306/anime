function parseInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer.`);
  return parsed;
}

export function parseShardConfig(env = process.env) {
  const countValue = env.DANIME_ENRICH_SHARD_COUNT;
  const indexValue = env.DANIME_ENRICH_SHARD_INDEX;
  if (countValue === undefined && indexValue === undefined) return { count: 1, index: 0 };
  if (countValue === undefined || indexValue === undefined) {
    throw new Error('DANIME_ENRICH_SHARD_COUNT and DANIME_ENRICH_SHARD_INDEX must be set together.');
  }

  const count = parseInteger(countValue, 'DANIME_ENRICH_SHARD_COUNT');
  const index = parseInteger(indexValue, 'DANIME_ENRICH_SHARD_INDEX');
  if (count < 1 || count > 64) throw new Error('DANIME_ENRICH_SHARD_COUNT must be between 1 and 64.');
  if (index < 0 || index >= count) {
    throw new Error('DANIME_ENRICH_SHARD_INDEX must be zero-based and smaller than the shard count.');
  }
  return { count, index };
}

export function stableShardIndex(value, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer.');
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % count;
}

export function selectShard(items, shard, key = (item) => item?.work_id) {
  return items.filter((item) => stableShardIndex(key(item), shard.count) === shard.index);
}
