export const DROP_PACK_LIMIT = 10;
export const DROP_WINDOW_MS = 60 * 60 * 1000;

export function getDropQuota(timestamps: readonly number[], now = Date.now()) {
  const ordered = timestamps.filter((timestamp) => timestamp <= now).sort((a, b) => a - b);
  if (!ordered.length) return { available: DROP_PACK_LIMIT, retryAt: null };

  const latest = ordered[ordered.length - 1];
  if (now - latest >= DROP_WINDOW_MS) return { available: DROP_PACK_LIMIT, retryAt: null };

  // A full hour of inactivity starts a new refill batch. Once ten packs are
  // used, all ten return together one hour after the last opening.
  let batchStart = ordered.length - 1;
  while (batchStart > 0 && ordered[batchStart] - ordered[batchStart - 1] < DROP_WINDOW_MS) batchStart--;
  const used = Math.min(DROP_PACK_LIMIT, ordered.length - batchStart);
  if (used >= DROP_PACK_LIMIT) return { available: 0, retryAt: latest + DROP_WINDOW_MS };
  return { available: DROP_PACK_LIMIT - used, retryAt: null };
}
