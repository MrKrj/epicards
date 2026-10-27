import { describe, expect, it } from 'vitest';
import { DROP_WINDOW_MS, getDropQuota } from '../lib/drop-quota';

describe('limite glissante de boosters gratuits', () => {
  const now = 10_000_000;
  it('autorise cinq ouvertures au départ', () => { expect(getDropQuota([], now)).toEqual({ available: 5, retryAt: null }); });
  it('bloque après cinq boosters gratuits dans la fenêtre de cinq minutes', () => {
    const timestamps = [0, 10, 20, 30, 40].map((n) => now - 60_000 + n);
    expect(getDropQuota(timestamps, now)).toEqual({ available: 0, retryAt: timestamps[0] + DROP_WINDOW_MS });
  });
  it('rend une ouverture dès que le plus ancien sort de la fenêtre', () => {
    const timestamps = [now - DROP_WINDOW_MS - 1, now - 4*60*1000, now - 3*60*1000, now - 2*60*1000, now - 60*1000];
    expect(getDropQuota(timestamps, now)).toEqual({ available: 1, retryAt: null });
  });
});
