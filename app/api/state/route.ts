import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/local-auth';
import { db, PACK_LIMIT, PACK_WINDOW_MS, userDto } from '@/lib/local-db';
export const runtime='nodejs';
export async function GET(){
 const user=await currentUser();if(!user)return NextResponse.json({error:'Connexion requise.'},{status:401});
 const now=Date.now(),recent=db.prepare('SELECT opened_at FROM booster_openings WHERE user_id=? AND is_free=1 AND opened_at>? ORDER BY opened_at ASC').all(user.id,now-PACK_WINDOW_MS) as Array<{opened_at:number}>;
 const owned=db.prepare('SELECT card_id FROM card_instances WHERE owner_id=? AND recycled_at IS NULL').all(user.id) as Array<{card_id:string}>;
 const auctioned=db.prepare(`SELECT DISTINCT ci.card_id FROM auction_listings a JOIN card_instances ci ON ci.id=a.instance_id WHERE a.seller_id=? AND a.status='active' AND ci.recycled_at IS NULL`).all(user.id) as Array<{card_id:string}>;
 const instances=db.prepare(`SELECT ci.id AS instance_id,ci.card_id,c.name,c.rarity,c.description,c.category,c.collection_value,c.image_url,c.set_id,(SELECT s.name FROM card_sets s WHERE s.id=c.set_id) AS set_name,ci.obtained_at FROM card_instances ci JOIN cards c ON c.id=ci.card_id WHERE ci.owner_id=? AND ci.recycled_at IS NULL ORDER BY ci.obtained_at DESC LIMIT 500`).all(user.id);
 const sets=db.prepare(`SELECT s.id,s.name,s.description,s.is_default,s.color,COUNT(c.id) AS card_count FROM card_sets s LEFT JOIN cards c ON c.set_id=s.id AND c.is_active=1 WHERE s.is_active=1 GROUP BY s.id ORDER BY s.is_default DESC,s.name`).all();
 return NextResponse.json({user:userDto(user),ownedCardIds:owned.map((row)=>row.card_id),auctionedCardIds:auctioned.map((row)=>row.card_id),ownedInstances:instances,collections:sets,recentDrops:recent.map((row)=>row.opened_at),packLimit:PACK_LIMIT,packWindowMs:PACK_WINDOW_MS});
}
