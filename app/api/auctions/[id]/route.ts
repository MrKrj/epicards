import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';
import { settleExpiredAuctions } from '@/lib/auctions';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await currentUser()) return NextResponse.json({ error: 'Connexion requise.' }, { status: 401 });
  const { id } = await params;
  try {
    const now = Date.now();
    if (db.prepare("SELECT 1 FROM auction_listings WHERE id=? AND status='active' AND ends_at<=?").get(id, now)) {
      settleExpiredAuctions(now);
    }
    const auction = db.prepare('SELECT id FROM auction_listings WHERE id=?').get(id);
    if (!auction) return NextResponse.json({ error: 'Enchère introuvable.' }, { status: 404 });
    const bids = db.prepare(`SELECT b.amount,b.created_at,u.username
      FROM auction_bids b JOIN users u ON u.id=b.bidder_id
      WHERE b.auction_id=?
      ORDER BY b.created_at DESC,b.id DESC LIMIT 10`).all(id) as
      Array<{ amount: number; created_at: number; username: string }>;
    return NextResponse.json({ bids }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Impossible de charger l’historique des enchères.' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Connexion requise.' }, { status: 401 });

  const { id } = await params;
  const now = Date.now();
  try {
    settleExpiredAuctions(now);
    db.exec('BEGIN IMMEDIATE');

    const auction = db.prepare(`SELECT id,seller_id,status,highest_bidder_id,ends_at
      FROM auction_listings WHERE id=?`).get(id) as {
        id: string; seller_id: number; status: string; highest_bidder_id: number | null; ends_at: number;
      } | undefined;

    if (!auction) {
      db.exec('ROLLBACK');
      return NextResponse.json({ error: 'Mise en vente introuvable.' }, { status: 404 });
    }
    if (auction.seller_id !== user.id) {
      db.exec('ROLLBACK');
      return NextResponse.json({ error: 'Tu ne peux annuler que tes propres mises en vente.' }, { status: 403 });
    }
    if (auction.status !== 'active' || auction.ends_at <= now) {
      db.exec('ROLLBACK');
      return NextResponse.json({ error: 'Cette mise en vente n’est plus active.' }, { status: 409 });
    }

    const hasBids = db.prepare('SELECT 1 FROM auction_bids WHERE auction_id=? LIMIT 1').get(id);
    if (hasBids || auction.highest_bidder_id !== null) {
      db.exec('ROLLBACK');
      return NextResponse.json({ error: 'Cette mise en vente ne peut plus être annulée : une enchère a déjà été faite.' }, { status: 409 });
    }

    const result = db.prepare(`UPDATE auction_listings SET status='cancelled',closed_at=?
      WHERE id=? AND seller_id=? AND status='active' AND highest_bidder_id IS NULL AND ends_at>?
        AND NOT EXISTS(SELECT 1 FROM auction_bids WHERE auction_id=?)`).run(now, id, user.id, now, id);
    if (Number(result.changes) !== 1) {
      db.exec('ROLLBACK');
      return NextResponse.json({ error: 'La mise en vente a changé ; recharge l’hôtel de vente puis réessaie.' }, { status: 409 });
    }

    db.exec('COMMIT');
    return NextResponse.json({ ok: true, message: 'Mise en vente annulée. La carte est de retour dans ta collection.' });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error(error);
    return NextResponse.json({ error: 'Impossible d’annuler cette mise en vente.' }, { status: 500 });
  }
}
