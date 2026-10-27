import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';
import { settleExpiredAuctionsInTransaction } from '@/lib/auctions';

export const runtime = 'nodejs';
const bidSchema = z.object({ amount: z.number().int().min(1).max(1_000_000) });

type Auction = {
  id: string; seller_id: number; start_price: number; current_bid: number;
  highest_bidder_id: number | null; ends_at: number;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Connexion requise.' }, { status: 401 });
  const { id } = await params;
  const parsed = bidSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Montant d’enchère invalide.' }, { status: 400 });
  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    settleExpiredAuctionsInTransaction(now);
    const auction = db.prepare(`SELECT id,seller_id,start_price,current_bid,highest_bidder_id,ends_at
      FROM auction_listings WHERE id=? AND status='active'`).get(id) as Auction | undefined;
    if (!auction) {
      const exists = db.prepare('SELECT id FROM auction_listings WHERE id=?').get(id);
      if (exists) db.exec('COMMIT'); else db.exec('ROLLBACK');
      return NextResponse.json({ error: 'Cette enchère est terminée ou introuvable.' }, { status: 409 });
    }
    if (auction.ends_at <= now) {
      settleExpiredAuctionsInTransaction(now);
      db.exec('COMMIT');
      return NextResponse.json({ error: 'Cette enchère vient de se terminer.' }, { status: 409 });
    }
    if (auction.seller_id === user.id) { db.exec('ROLLBACK'); return NextResponse.json({ error: 'Tu ne peux pas enchérir sur ta propre carte.' }, { status: 400 }); }
    if (auction.highest_bidder_id === user.id) { db.exec('ROLLBACK'); return NextResponse.json({ error: 'Tu es déjà le dernier enchérisseur sur cette carte.' }, { status: 409 }); }
    const { amount } = parsed.data;
    const minimumIncrement = Math.max(1, Math.ceil(auction.start_price * 0.1));
    const minimum = auction.highest_bidder_id === null ? auction.start_price : auction.current_bid + minimumIncrement;
    if (amount < minimum) { db.exec('ROLLBACK'); return NextResponse.json({ error: `L’enchère minimale est de ${minimum} fragments.` }, { status: 400 }); }
    const bidder = db.prepare('SELECT points FROM users WHERE id=?').get(user.id) as { points: number } | undefined;
    if (!bidder) { db.exec('ROLLBACK'); return NextResponse.json({ error: 'Compte introuvable.' }, { status: 404 }); }
    const ownEscrow = auction.highest_bidder_id === user.id ? auction.current_bid : 0;
    if (bidder.points + ownEscrow < amount) { db.exec('ROLLBACK'); return NextResponse.json({ error: 'Tu n’as pas assez de fragments pour cette enchère.' }, { status: 400 }); }
    if (auction.highest_bidder_id !== null) {
      const previous = db.prepare('SELECT points FROM users WHERE id=?').get(auction.highest_bidder_id) as { points: number } | undefined;
      if (!previous) throw new Error('Ancien enchérisseur introuvable.');
      const refunded = previous.points + auction.current_bid;
      db.prepare('UPDATE users SET points=? WHERE id=?').run(refunded, auction.highest_bidder_id);
      db.prepare(`INSERT INTO wallet_transactions(user_id,amount,balance_after,reason,reference_id,created_at)
        VALUES(?,?,?,?,?,?)`).run(auction.highest_bidder_id, auction.current_bid, refunded,
        auction.highest_bidder_id === user.id ? 'Ajustement de mise' : 'Enchère surenchérie · remboursement', id, now);
    }
    const newBalance = bidder.points + ownEscrow - amount;
    db.prepare('UPDATE users SET points=? WHERE id=?').run(newBalance, user.id);
    db.prepare(`INSERT INTO wallet_transactions(user_id,amount,balance_after,reason,reference_id,created_at)
      VALUES(?,?,?,?,?,?)`).run(user.id, -amount, newBalance, 'Mise en enchère', id, now);
    db.prepare('INSERT INTO auction_bids(id,auction_id,bidder_id,amount,created_at) VALUES(?,?,?,?,?)')
      .run(randomUUID(), id, user.id, amount, now);
    db.prepare(`UPDATE auction_listings SET current_bid=?,highest_bidder_id=?
      WHERE id=? AND status='active' AND ends_at>?`).run(amount, user.id, id, now);
    db.exec('COMMIT');
    return NextResponse.json({ ok: true, amount, balance: newBalance });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error(error);
    return NextResponse.json({ error: 'Impossible d’enregistrer cette enchère.' }, { status: 500 });
  }
}
