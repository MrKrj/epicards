import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';
import { settleExpiredAuctions } from '@/lib/auctions';

export const runtime = 'nodejs';
const createSchema = z.object({
  cardId: z.string().min(1).max(120),
  startPrice: z.number().int().min(1).max(1_000_000),
  durationMinutes: z.union([z.literal(30), z.literal(120), z.literal(480), z.literal(1440)]),
});

type AuctionRow = {
  id: string; card_id: string; name: string; description: string; category: string;
  rarity: string; image_url: string | null; set_id: string; set_name: string;
  seller_id: number; seller_username: string; start_price: number; current_bid: number;
  highest_bidder_id: number | null; bidder_username: string | null; ends_at: number;
  created_at: number; average_sale: number | null; sales_count: number;
};

export async function GET(request: Request) {
  if (!await currentUser()) return NextResponse.json({ error: 'Connexion requise.' }, { status: 401 });
  try {
    if (db.prepare("SELECT 1 FROM auction_listings WHERE status='active' AND ends_at<=? LIMIT 1").get(Date.now())) {
      settleExpiredAuctions();
    }
    const cardId = new URL(request.url).searchParams.get('cardId');
    const average = cardId ? db.prepare(`SELECT AVG(price) AS average_sale,COUNT(*) AS sales_count
      FROM auction_sales WHERE card_id=?`).get(cardId) as { average_sale: number | null; sales_count: number } : null;
    if (cardId) return NextResponse.json({ auctions: [], averageSale: average?.average_sale ?? null, salesCount: average?.sales_count ?? 0 });
    const auctions = db.prepare(`
      SELECT a.id,a.start_price,a.current_bid,a.highest_bidder_id,a.ends_at,a.created_at,
        c.id AS card_id,c.name,c.description,c.category,c.rarity,c.image_url,c.set_id,s.name AS set_name,
        a.seller_id,seller.username AS seller_username,bidder.username AS bidder_username,
        (SELECT AVG(sale.price) FROM auction_sales sale WHERE sale.card_id=c.id) AS average_sale,
        (SELECT COUNT(*) FROM auction_sales sale WHERE sale.card_id=c.id) AS sales_count
      FROM auction_listings a
      JOIN card_instances ci ON ci.id=a.instance_id
      JOIN cards c ON c.id=ci.card_id
      JOIN card_sets s ON s.id=c.set_id
      JOIN users seller ON seller.id=a.seller_id
      LEFT JOIN users bidder ON bidder.id=a.highest_bidder_id
      WHERE a.status='active' AND a.ends_at>?
      ORDER BY a.ends_at ASC,a.created_at DESC LIMIT 200
    `).all(Date.now()) as AuctionRow[];
    return NextResponse.json({ auctions, averageSale: average?.average_sale ?? null, salesCount: average?.sales_count ?? 0 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Impossible de charger l’hôtel de vente.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Connexion requise.' }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Paramètres d’enchère invalides.' }, { status: 400 });
  const { cardId, startPrice, durationMinutes } = parsed.data;
  const now = Date.now(), auctionId = randomUUID(), endsAt = now + durationMinutes * 60 * 1000;
  settleExpiredAuctions(now);
  db.exec('BEGIN IMMEDIATE');
  try {
    const activeCount = db.prepare(`SELECT COUNT(*) AS count FROM auction_listings
      WHERE seller_id=? AND status='active' AND ends_at>?`).get(user.id, now) as { count: number };
    if (activeCount.count >= 5) {
      db.exec('ROLLBACK');
      return NextResponse.json({ error: 'Tu as déjà cinq ventes actives. Attends qu’une enchère se termine avant d’en mettre une autre.' }, { status: 409 });
    }
    const card = db.prepare(`SELECT c.id FROM cards c JOIN card_sets s ON s.id=c.set_id
      WHERE c.id=? AND c.is_active=1 AND s.is_active=1`).get(cardId);
    if (!card) { db.exec('ROLLBACK'); return NextResponse.json({ error: 'Cette carte n’est plus disponible.' }, { status: 404 }); }
    const duplicateType = db.prepare(`SELECT 1 FROM auction_listings a JOIN card_instances ci ON ci.id=a.instance_id
      WHERE a.seller_id=? AND ci.card_id=? AND a.status='active' LIMIT 1`).get(user.id, cardId);
    if (duplicateType) { db.exec('ROLLBACK'); return NextResponse.json({ error: 'Tu as déjà un exemplaire de ce type de carte en enchère.' }, { status: 409 }); }
    const instance = db.prepare(`SELECT ci.id FROM card_instances ci
      WHERE ci.card_id=? AND ci.owner_id=? AND ci.recycled_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM auction_listings a WHERE a.instance_id=ci.id AND a.status='active')
      ORDER BY ci.obtained_at,ci.id LIMIT 1`).get(cardId, user.id) as { id: string } | undefined;
    if (!instance) { db.exec('ROLLBACK'); return NextResponse.json({ error: 'Aucun exemplaire disponible : il est peut-être déjà en enchère.' }, { status: 409 }); }
    db.prepare(`INSERT INTO auction_listings(id,instance_id,seller_id,start_price,current_bid,starts_at,ends_at,status,created_at)
      VALUES(?,?,?,?,?,?,?,'active',?)`).run(auctionId, instance.id, user.id, startPrice, startPrice, now, endsAt, now);
    db.exec('COMMIT');
    return NextResponse.json({ ok: true, auctionId, endsAt });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error(error);
    return NextResponse.json({ error: 'Impossible de mettre cette carte en enchère.' }, { status: 500 });
  }
}
