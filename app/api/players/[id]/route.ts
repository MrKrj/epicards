import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await currentUser()) {
    return NextResponse.json({ error: 'Connecte-toi pour consulter les joueurs.' }, { status: 401 });
  }

  const { id: rawId } = await params;
  const playerId = Number(rawId);
  if (!Number.isSafeInteger(playerId) || playerId < 1) {
    return NextResponse.json({ error: 'Joueur introuvable.' }, { status: 404 });
  }

  const player = db.prepare(`
    WITH catalogue AS (
      SELECT COUNT(*) AS total_cards FROM cards WHERE is_active=1
    ), owned_cards AS (
      SELECT DISTINCT c.id,c.rarity FROM card_instances ci
      JOIN cards c ON c.id=ci.card_id AND c.is_active=1
      WHERE ci.owner_id=? AND ci.recycled_at IS NULL
    ), shiny_total AS (
      SELECT COUNT(*) AS shiny_cards FROM card_instances WHERE owner_id=? AND recycled_at IS NULL AND is_shiny=1
    )
    SELECT u.id,u.username,u.created_at,catalogue.total_cards,shiny_total.shiny_cards,
      COUNT(owned_cards.id) AS distinct_cards,
      COUNT(CASE WHEN owned_cards.rarity='Secrète' THEN 1 END) AS secret_cards,
      COUNT(CASE WHEN owned_cards.rarity='Légendaire' THEN 1 END) AS legendary_cards,
      COUNT(CASE WHEN owned_cards.rarity='Épique' THEN 1 END) AS epic_cards,
      COUNT(CASE WHEN owned_cards.rarity='Rare' THEN 1 END) AS rare_cards,
      COUNT(CASE WHEN owned_cards.rarity='Peu commune' THEN 1 END) AS uncommon_cards,
      COUNT(CASE WHEN owned_cards.rarity='Commune' THEN 1 END) AS common_cards
    FROM users u CROSS JOIN catalogue CROSS JOIN shiny_total LEFT JOIN owned_cards ON 1=1
    WHERE u.id=? GROUP BY u.id
  `).get(playerId, playerId, playerId) as {
    id:number;username:string;created_at:number;total_cards:number;shiny_cards:number;distinct_cards:number;
    secret_cards:number;legendary_cards:number;epic_cards:number;rare_cards:number;uncommon_cards:number;common_cards:number;
  } | undefined;

  if (!player) return NextResponse.json({ error: 'Joueur introuvable.' }, { status: 404 });

  const seriesProgress = db.prepare(`
    SELECT s.id,s.name,COUNT(DISTINCT c.id) AS total_cards,
      COUNT(DISTINCT owned.card_id) AS owned_cards
    FROM card_sets s
    LEFT JOIN cards c ON c.set_id=s.id AND c.is_active=1
    LEFT JOIN (
      SELECT DISTINCT ci.card_id FROM card_instances ci
      WHERE ci.owner_id=? AND ci.recycled_at IS NULL
    ) owned ON owned.card_id=c.id
    WHERE s.is_active=1
    GROUP BY s.id
    ORDER BY s.name COLLATE NOCASE ASC
  `).all(playerId) as Array<{id:string;name:string;total_cards:number;owned_cards:number}>;

  const setId = new URL(request.url).searchParams.get('setId');
  if (!setId) return NextResponse.json({ error: 'Choisis une série.' }, { status: 400 });

  const collection = db.prepare('SELECT id, name FROM card_sets WHERE id = ? AND is_active = 1').get(setId) as { id: string; name: string } | undefined;
  if (!collection) return NextResponse.json({ error: 'Série introuvable.' }, { status: 404 });

  const cards = db.prepare(`
    SELECT c.id, c.name, c.description, c.category, c.rarity, c.image_url,
      (SELECT COUNT(*) FROM card_instances shiny WHERE shiny.card_id=c.id AND shiny.owner_id=? AND shiny.recycled_at IS NULL AND shiny.is_shiny=1) AS shiny_count,
      EXISTS(
        SELECT 1 FROM card_instances owned
        WHERE owned.card_id = c.id AND owned.owner_id = ? AND owned.recycled_at IS NULL
      ) AS owned
    FROM cards c
    WHERE c.set_id = ? AND c.is_active = 1
      AND EXISTS(
        SELECT 1 FROM card_instances owned
        WHERE owned.card_id = c.id AND owned.owner_id = ? AND owned.recycled_at IS NULL
      )
    ORDER BY CASE c.rarity
      WHEN 'Secrète' THEN 6
      WHEN 'Légendaire' THEN 5
      WHEN 'Épique' THEN 4
      WHEN 'Rare' THEN 3
      WHEN 'Peu commune' THEN 2
      WHEN 'Commune' THEN 1
      ELSE 0
    END DESC, c.name COLLATE NOCASE ASC
  `).all(playerId, playerId, setId, playerId);

  return NextResponse.json({ player, collection, cards, seriesProgress });
}
