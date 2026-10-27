import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';
import { settleExpiredAuctions } from '@/lib/auctions';

export const runtime = 'nodejs';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Connexion requise.' }, { status: 401 });
  if (db.prepare("SELECT 1 FROM auction_listings WHERE status='active' AND ends_at<=? LIMIT 1").get(Date.now())) {
    settleExpiredAuctions();
  }
  const notifications = db.prepare(`
    SELECT n.id,n.type,n.title,n.message,n.card_id,n.created_at,n.read_at,
      c.name AS card_name,c.set_id
    FROM notifications n LEFT JOIN cards c ON c.id=n.card_id
    WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 30
  `).all(user.id);
  return NextResponse.json({ notifications });
}
