import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';

export const runtime = 'nodejs';

export async function GET() {
  if (!await currentUser()) {
    return NextResponse.json({ error: 'Connecte-toi pour consulter le classement.' }, { status: 401 });
  }

  const players = db.prepare(`
    WITH catalogue AS (
      SELECT COUNT(*) AS total_cards FROM cards WHERE is_active=1
    )
    SELECT u.id,u.username,u.created_at,catalogue.total_cards,
      COUNT(DISTINCT c.id) AS distinct_cards,
      COUNT(DISTINCT CASE WHEN c.rarity='Secrète' THEN c.id END) AS secret_cards,
      COUNT(DISTINCT CASE WHEN c.rarity='Légendaire' THEN c.id END) AS legendary_cards,
      COUNT(DISTINCT CASE WHEN c.rarity='Épique' THEN c.id END) AS epic_cards,
      COUNT(DISTINCT CASE WHEN c.rarity='Rare' THEN c.id END) AS rare_cards,
      COUNT(DISTINCT CASE WHEN c.rarity='Peu commune' THEN c.id END) AS uncommon_cards,
      COUNT(DISTINCT CASE WHEN c.rarity='Commune' THEN c.id END) AS common_cards
    FROM users u
    CROSS JOIN catalogue
    LEFT JOIN card_instances ci ON ci.owner_id=u.id AND ci.recycled_at IS NULL
    LEFT JOIN cards c ON c.id=ci.card_id AND c.is_active=1
    GROUP BY u.id
    ORDER BY distinct_cards DESC,secret_cards DESC,legendary_cards DESC,
      epic_cards DESC,rare_cards DESC,uncommon_cards DESC,common_cards DESC,
      u.username COLLATE NOCASE ASC
  `).all();

  return NextResponse.json({ players });
}
