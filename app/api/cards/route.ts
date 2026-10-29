import { NextResponse } from 'next/server';
import { db } from '@/lib/local-db';
import { currentUser } from '@/lib/local-auth';

export const runtime = 'nodejs';

const catalogueQuery = `
  SELECT c.id,c.name,c.description,c.rarity,c.category,c.collection_value,
    c.set_id,c.image_url,c.booster_eligible,s.name AS set_name,
    s.is_default AS set_is_default
  FROM cards c
  JOIN card_sets s ON s.id=c.set_id
  WHERE c.is_active=1
    AND s.is_active=1
    AND c.rarity NOT IN ('Secrète','Secrete')
    AND EXISTS (
      SELECT 1 FROM card_instances ci
      JOIN users u ON u.id=ci.owner_id
      WHERE ci.card_id=c.id AND ci.is_shiny=0 AND u.role IN ('player','moderator')
    )
  ORDER BY s.is_default DESC,s.name COLLATE NOCASE,
    CASE c.rarity
      WHEN 'Commune' THEN 0
      WHEN 'Peu commune' THEN 1
      WHEN 'Rare' THEN 2
      WHEN 'Épique' THEN 3
      WHEN 'Légendaire' THEN 4
      ELSE 99
    END,
    c.name COLLATE NOCASE
  LIMIT 500`;

const allCardsQuery = `
  SELECT c.id,c.name,c.description,c.rarity,c.category,c.collection_value,
    c.set_id,c.image_url,c.booster_eligible,s.name AS set_name,
    s.is_default AS set_is_default
  FROM cards c
  JOIN card_sets s ON s.id=c.set_id
  WHERE c.is_active=1 AND s.is_active=1
  ORDER BY s.is_default DESC,s.name COLLATE NOCASE,
    CASE c.rarity
      WHEN 'Commune' THEN 0
      WHEN 'Peu commune' THEN 1
      WHEN 'Rare' THEN 2
      WHEN 'Épique' THEN 3
      WHEN 'Légendaire' THEN 4
      WHEN 'Secrète' THEN 5
      ELSE 99
    END,
    c.name COLLATE NOCASE
  LIMIT 500`;

export async function GET(request: Request) {
  const admin = (await currentUser())?.role === 'admin';
  const url = new URL(request.url);
  if (url.searchParams.get('view') === 'discovery') {
    if (admin) return NextResponse.json({ hasUndiscoveredCards: false }, { headers: { 'Cache-Control': 'no-store' } });

    const conditions = [
      'c.is_active=1',
      's.is_active=1',
      "c.rarity NOT IN ('Secrète','Secrete','secrète','secrete','SECRÈTE','SECRETE')",
      `NOT EXISTS (
        SELECT 1 FROM card_instances ci
        JOIN users u ON u.id=ci.owner_id
        WHERE ci.card_id=c.id AND ci.is_shiny=0 AND u.role IN ('player','moderator')
      )`,
    ];
    const values: string[] = [];
    const setId = url.searchParams.get('set_id');
    const rarity = url.searchParams.get('rarity');
    if (setId && setId !== 'Toutes') { conditions.push('c.set_id=?'); values.push(setId); }
    if (rarity && rarity !== 'Toutes') { conditions.push('c.rarity=?'); values.push(rarity); }

    // Keep undiscovered card names server-side. Only return whether any hidden
    // card matches the active text filter, so the discovery mechanic does not
    // leak the catalogue itself.
    const candidates = db.prepare(`SELECT c.name,c.category FROM cards c
      JOIN card_sets s ON s.id=c.set_id WHERE ${conditions.join(' AND ')}`).all(...values) as
      Array<{ name: string; category: string }>;
    const query = (url.searchParams.get('q') ?? '').toLocaleLowerCase('fr');
    const hasUndiscoveredCards = candidates.some((card) =>
      card.name.toLocaleLowerCase('fr').includes(query) || card.category.toLocaleLowerCase('fr').includes(query));
    return NextResponse.json({ hasUndiscoveredCards }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const selectedQuery = admin ? allCardsQuery : catalogueQuery;
  const catalogueCards = db.prepare(selectedQuery).all();
  const totalCardCount = (db.prepare(`SELECT COUNT(*) AS count FROM cards c
    JOIN card_sets s ON s.id=c.set_id WHERE c.is_active=1 AND s.is_active=1`).get() as { count: number }).count;
  if (url.searchParams.get('view') === 'catalogue') {
    return NextResponse.json({ cards: catalogueCards, totalCardCount }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json({ cards: catalogueCards, catalogueCards, totalCardCount }, { headers: { 'Cache-Control': 'no-store' } });
}
