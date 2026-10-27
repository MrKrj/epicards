import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';

export const runtime = 'nodejs';

export async function GET() {
  if (!await currentUser()) {
    return NextResponse.json({ error: 'Connecte-toi pour consulter les joueurs.' }, { status: 401 });
  }

  const players = db.prepare(`
    SELECT u.id, u.username, u.created_at, COUNT(DISTINCT c.id) AS distinct_cards
    FROM users u
    LEFT JOIN card_instances ci ON ci.owner_id = u.id AND ci.recycled_at IS NULL
    LEFT JOIN cards c ON c.id = ci.card_id AND c.is_active = 1
    GROUP BY u.id
    ORDER BY u.username COLLATE NOCASE ASC
  `).all();

  return NextResponse.json({ players });
}
