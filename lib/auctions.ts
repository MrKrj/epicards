import { randomUUID } from 'node:crypto';
import { db } from './local-db';

type ExpiredAuction = {
  id: string;
  instance_id: string;
  card_id: string;
  seller_id: number;
  highest_bidder_id: number | null;
  current_bid: number;
  card_name: string;
};

/** Must be called inside a BEGIN IMMEDIATE transaction. */
export function settleExpiredAuctionsInTransaction(now: number) {
  const expired = db.prepare(`
    SELECT a.id,a.instance_id,a.seller_id,a.highest_bidder_id,a.current_bid,ci.card_id,c.name AS card_name
    FROM auction_listings a JOIN card_instances ci ON ci.id=a.instance_id JOIN cards c ON c.id=ci.card_id
    WHERE a.status='active' AND a.ends_at<=?
    ORDER BY a.ends_at,a.id
  `).all(now) as ExpiredAuction[];
  for (const auction of expired) {
    if (auction.highest_bidder_id !== null) {
      const transfer = db.prepare(`UPDATE card_instances SET owner_id=?,source='trade',obtained_at=?
        WHERE id=? AND owner_id=? AND recycled_at IS NULL`).run(
        auction.highest_bidder_id, now, auction.instance_id, auction.seller_id,
      );
      if (Number(transfer.changes) !== 1) throw new Error(`Impossible de transférer l'exemplaire de l'enchère ${auction.id}.`);
      const seller = db.prepare('SELECT points,username FROM users WHERE id=?').get(auction.seller_id) as { points: number; username: string } | undefined;
      const buyer = db.prepare('SELECT username FROM users WHERE id=?').get(auction.highest_bidder_id) as { username: string } | undefined;
      if (!seller || !buyer) throw new Error(`Vendeur ou acheteur introuvable pour l'enchère ${auction.id}.`);
      const newBalance = seller.points + auction.current_bid;
      db.prepare('UPDATE users SET points=? WHERE id=?').run(newBalance, auction.seller_id);
      db.prepare(`INSERT INTO wallet_transactions(user_id,amount,balance_after,reason,reference_id,created_at)
        VALUES(?,?,?,?,?,?)`).run(auction.seller_id, auction.current_bid, newBalance,
        'Vente aux enchères', auction.id, now);
      db.prepare(`INSERT INTO auction_sales(auction_id,card_id,seller_id,buyer_id,price,sold_at)
        VALUES(?,?,?,?,?,?)`).run(auction.id, auction.card_id, auction.seller_id,
        auction.highest_bidder_id, auction.current_bid, now);
      db.prepare(`INSERT INTO notifications(id,user_id,type,title,message,card_id,created_at)
        VALUES(?,?,'auction_won','Enchère remportée !',?,?,?)`).run(
        randomUUID(), auction.highest_bidder_id, `Tu as remporté « ${auction.card_name} » et la carte est dans ta collection.`,
        auction.card_id, now,
      );
      db.prepare(`INSERT INTO notifications(id,user_id,type,title,message,card_id,created_at)
        VALUES(?,?,'auction_sold','Ta carte a été vendue',?,?,?)`).run(
        randomUUID(), auction.seller_id, `« ${auction.card_name} » a été vendue pour ${auction.current_bid.toLocaleString('fr-FR')} fragments à ${buyer.username}. Les fragments ont été crédités à ton compte.`,
        auction.card_id, now,
      );
      db.prepare(`UPDATE auction_listings SET status='sold',closed_at=? WHERE id=? AND status='active'`).run(now, auction.id);
    } else {
      db.prepare(`INSERT INTO notifications(id,user_id,type,title,message,card_id,created_at)
        VALUES(?,?,'auction_unsold','Enchère terminée sans acheteur',?,?,?)`).run(
        randomUUID(), auction.seller_id, `Personne n’a enchéri sur « ${auction.card_name} ». La carte est de retour dans ta collection.`,
        auction.card_id, now,
      );
      db.prepare(`UPDATE auction_listings SET status='ended',closed_at=? WHERE id=? AND status='active'`).run(now, auction.id);
    }
  }
  return expired.length;
}

export function settleExpiredAuctions(now = Date.now()) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const count = settleExpiredAuctionsInTransaction(now);
    db.exec('COMMIT');
    return count;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}
