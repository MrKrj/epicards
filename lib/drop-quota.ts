export const DROP_PACK_LIMIT = 10;
export const DROP_WINDOW_MS = 60 * 60 * 1000;

export function getDropQuota(timestamps: readonly number[], now = Date.now()) {
  const recent = timestamps.filter((timestamp) => timestamp <= now && now - timestamp < DROP_WINDOW_MS);
  const retryAt = recent.length >= DROP_PACK_LIMIT ? Math.min(...recent) + DROP_WINDOW_MS : null;
  return { available: Math.max(0, DROP_PACK_LIMIT - recent.length), retryAt };
}
