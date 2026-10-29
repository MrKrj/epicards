import { describe, expect, it } from 'vitest';
import { ANTI_SNIPE_WINDOW_MS, extendAuctionEndIfNeeded } from '../lib/auction-timing';

describe('prolongation anti-dernière-seconde', () => {
  const now = 1_000_000;

  it('ajoute une minute quand une mise arrive dans la dernière minute', () => {
    const endsAt = now + 1;
    expect(extendAuctionEndIfNeeded(endsAt, now)).toBe(endsAt + ANTI_SNIPE_WINDOW_MS);
  });

  it('ne prolonge pas une enchère quand il reste exactement une minute', () => {
    const endsAt = now + ANTI_SNIPE_WINDOW_MS;
    expect(extendAuctionEndIfNeeded(endsAt, now)).toBe(endsAt);
  });

  it('ne prolonge pas une enchère qui a encore plus d’une minute', () => {
    const endsAt = now + ANTI_SNIPE_WINDOW_MS + 1;
    expect(extendAuctionEndIfNeeded(endsAt, now)).toBe(endsAt);
  });
});
