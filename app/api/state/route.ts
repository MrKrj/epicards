import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/local-auth';
import { db, PACK_LIMIT, PACK_WINDOW_MS, userDto } from '@/lib/local-db';
import type { CombatRoleId } from '@/lib/combat-profiles';
export const runtime='nodejs';
export async function GET(){
 const user=await currentUser();if(!user)return NextResponse.json({error:'Connexion requise.'},{status:401});
 const now=Date.now(),recent=db.prepare('SELECT opened_at FROM booster_openings WHERE user_id=? AND is_free=1 ORDER BY opened_at DESC LIMIT 11').all(user.id) as Array<{opened_at:number}>;
 const owned=db.prepare('SELECT card_id FROM card_instances WHERE owner_id=? AND recycled_at IS NULL').all(user.id) as Array<{card_id:string}>;
 const auctioned=db.prepare(`SELECT DISTINCT ci.card_id,ci.is_shiny FROM auction_listings a JOIN card_instances ci ON ci.id=a.instance_id WHERE a.seller_id=? AND a.status='active' AND ci.recycled_at IS NULL`).all(user.id) as Array<{card_id:string;is_shiny:number}>;
 const activeAuctionCount=(db.prepare("SELECT COUNT(*) AS count FROM auction_listings WHERE seller_id=? AND status='active' AND ends_at>?").get(user.id,now) as {count:number}).count;
 const instances=db.prepare(`SELECT ci.id AS instance_id,ci.card_id,c.name,c.rarity,c.description,c.category,c.collection_value,c.image_url,c.set_id,s.name AS set_name,ci.obtained_at,ci.is_shiny,cp.role_id,cp.power AS combat_power,cp.stability,cp.expertise FROM card_instances ci JOIN cards c ON c.id=ci.card_id JOIN card_sets s ON s.id=c.set_id LEFT JOIN card_combat_profiles cp ON cp.card_id=c.id WHERE ci.owner_id=? AND ci.recycled_at IS NULL ORDER BY ci.obtained_at DESC`).all(user.id) as Array<{instance_id:string;card_id:string;name:string;rarity:string;description:string;category:string;collection_value:number;image_url:string|null;set_id:string;set_name:string;obtained_at:number;is_shiny:number;role_id:CombatRoleId|null;combat_power:number|null;stability:number|null;expertise:number|null}>;
 const ownedInstances=instances.map(({role_id,combat_power,stability,expertise,...instance})=>({...instance,combatProfile:role_id&&combat_power!==null&&stability!==null&&expertise!==null?{role:role_id,power:combat_power,stability,expertise}:null}));
 const sets=db.prepare(`SELECT s.id,s.name,s.description,s.is_default,s.color,COUNT(c.id) AS card_count FROM card_sets s LEFT JOIN cards c ON c.set_id=s.id AND c.is_active=1 WHERE s.is_active=1 GROUP BY s.id ORDER BY s.is_default DESC,s.name`).all();
 return NextResponse.json({user:userDto(user),ownedCardIds:owned.map((row)=>row.card_id),auctionedCardIds:auctioned.map((row)=>row.card_id),auctionedCardVariants:auctioned,activeAuctionCount,ownedInstances,collections:sets,recentDrops:recent.map((row)=>row.opened_at),packLimit:PACK_LIMIT,packWindowMs:PACK_WINDOW_MS});
}
