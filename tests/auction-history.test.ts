import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/local-auth', () => ({ currentUser: vi.fn() }));
vi.mock('@/lib/local-db', () => ({ db: { prepare: vi.fn() } }));
vi.mock('@/lib/auctions', () => ({ settleExpiredAuctions: vi.fn() }));

import { GET } from '../app/api/auctions/[id]/route';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';

describe('historique public d’une enchère', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(currentUser).mockResolvedValue({
      id: 42, username: 'lecteur', role: 'player', points: 0, created_at: Date.now(),
    });
  });

  it('renvoie uniquement les dix dernières mises et ne met pas la réponse en cache', async () => {
    const bids = [
      { amount: 180, created_at: 3000, username: 'Alice' },
      { amount: 150, created_at: 2000, username: 'Bastien' },
    ];
    vi.mocked(db.prepare).mockImplementation((sql: string) => ({
      get: () => sql.includes("status='active'") ? undefined : { id: 'auction-1' },
      all: () => bids,
    }) as never);

    const response = await GET(new Request('http://localhost/api/auctions/auction-1'), {
      params: Promise.resolve({ id: 'auction-1' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ bids });
    expect(vi.mocked(db.prepare).mock.calls.at(-1)?.[0]).toContain('LIMIT 10');
  });

  it('refuse l’accès sans session', async () => {
    vi.mocked(currentUser).mockResolvedValue(null);
    const response = await GET(new Request('http://localhost/api/auctions/auction-1'), {
      params: Promise.resolve({ id: 'auction-1' }),
    });
    expect(response.status).toBe(401);
  });
});
