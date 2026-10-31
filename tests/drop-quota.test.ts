import { describe, expect, it } from 'vitest';
import { DROP_WINDOW_MS, getDropQuota } from '../lib/drop-quota';

describe('recharge groupée des boosters gratuits', () => {
  const now = 10_000_000;
  it('autorise dix ouvertures au départ', () => { expect(getDropQuota([], now)).toEqual({ available: 10, retryAt: null }); });
  it('décompte les boosters utilisés puis bloque après le dixième', () => {
    const partial = Array.from({ length: 9 }, (_, index) => now - 60_000 + index);
    expect(getDropQuota(partial, now)).toEqual({ available: 1, retryAt: null });
    const timestamps = [...partial, now - 60_000 + 9];
    expect(getDropQuota(timestamps, now)).toEqual({ available: 0, retryAt: timestamps.at(-1)! + DROP_WINDOW_MS });
  });
  it('recharge les dix boosters ensemble après une heure', () => {
    const timestamps = Array.from({ length: 10 }, (_, index) => now - 60_000 + index);
    const cooldownEndsAt = timestamps.at(-1)! + DROP_WINDOW_MS;
    expect(getDropQuota(timestamps, cooldownEndsAt)).toEqual({ available: 10, retryAt: null });
  });
});
