import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';

export const runtime='nodejs';
const updateSchema=z.object({username:z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_-]+$/),points:z.number().int().min(0).max(1_000_000)});
async function admin(){return (await currentUser())?.role==='admin'}
function parseId(value:string){const id=Number(value);return Number.isSafeInteger(id)&&id>0?id:null}

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
 if(!await admin())return NextResponse.json({error:'Accès administrateur requis.'},{status:403});
 const {id:rawId}=await params,id=parseId(rawId);if(!id)return NextResponse.json({error:'Utilisateur invalide.'},{status:400});
 const parsed=updateSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message??'Données invalides.'},{status:400});
 const old=db.prepare('SELECT points FROM users WHERE id=?').get(id) as {points:number}|undefined;if(!old)return NextResponse.json({error:'Utilisateur introuvable.'},{status:404});
 try{db.exec('BEGIN IMMEDIATE');const delta=parsed.data.points-old.points;db.prepare('UPDATE users SET username=?,points=? WHERE id=?').run(parsed.data.username,parsed.data.points,id);if(delta)db.prepare('INSERT INTO wallet_transactions(user_id,amount,balance_after,reason,created_at) VALUES(?,?,?,?,?)').run(id,delta,parsed.data.points,'ajustement_admin',Date.now());db.exec('COMMIT');return NextResponse.json({ok:true})}
 catch(error){try{db.exec('ROLLBACK')}catch{};if(String(error).includes('users.username'))return NextResponse.json({error:'Ce pseudo est déjà utilisé.'},{status:409});return NextResponse.json({error:'Impossible de modifier cet utilisateur.'},{status:500})}
}

export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){
 const adminUser=await currentUser();if(adminUser?.role!=='admin')return NextResponse.json({error:'Accès administrateur requis.'},{status:403});
 const {id:rawId}=await params,id=parseId(rawId);if(!id)return NextResponse.json({error:'Utilisateur invalide.'},{status:400});
 if(id===adminUser.id)return NextResponse.json({error:'Tu ne peux pas supprimer le compte avec lequel tu es connecté.'},{status:400});
 const target=db.prepare('SELECT id,role FROM users WHERE id=?').get(id) as {id:number;role:string}|undefined;if(!target)return NextResponse.json({error:'Utilisateur introuvable.'},{status:404});
 if(target.role==='admin'&&Number((db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin'").get() as {count:number}).count)<=1)return NextResponse.json({error:'Impossible de supprimer le dernier administrateur.'},{status:400});
 try{
  db.exec('BEGIN IMMEDIATE');
  const ownListings=db.prepare('SELECT id FROM auction_listings WHERE seller_id=? OR instance_id IN (SELECT id FROM card_instances WHERE owner_id=?)').all(id,id) as Array<{id:string}>;
  const ownListingIds=ownListings.map(row=>row.id);
  if(ownListingIds.length){
   const marks=ownListingIds.map(()=>'?').join(',');
   const refunds=db.prepare(`SELECT id,current_bid,highest_bidder_id FROM auction_listings WHERE status='active' AND highest_bidder_id IS NOT NULL AND highest_bidder_id<>? AND id IN (${marks})`).all(id,...ownListingIds) as Array<{id:string;current_bid:number;highest_bidder_id:number}>;
   for(const auction of refunds){const now=Date.now();db.prepare('UPDATE users SET points=points+? WHERE id=?').run(auction.current_bid,auction.highest_bidder_id);const balance=(db.prepare('SELECT points FROM users WHERE id=?').get(auction.highest_bidder_id) as {points:number}).points;db.prepare('INSERT INTO wallet_transactions(user_id,amount,balance_after,reason,reference_id,created_at) VALUES(?,?,?,?,?,?)').run(auction.highest_bidder_id,auction.current_bid,balance,'remboursement_vente_annulée',auction.id,now)}
  }
  const winningListings=db.prepare("SELECT id FROM auction_listings WHERE highest_bidder_id=? AND status='active'").all(id) as Array<{id:string}>;
  for(const listing of winningListings){
   if(ownListingIds.includes(listing.id))continue;
   db.prepare("UPDATE auction_listings SET status='cancelled',highest_bidder_id=NULL,current_bid=start_price,closed_at=? WHERE id=?").run(Date.now(),listing.id);
   db.prepare('DELETE FROM auction_bids WHERE auction_id=?').run(listing.id);
  }
  db.prepare('UPDATE auction_listings SET highest_bidder_id=NULL WHERE highest_bidder_id=?').run(id);
  db.prepare('DELETE FROM auction_sales WHERE seller_id=? OR buyer_id=? OR auction_id IN (SELECT id FROM auction_listings WHERE seller_id=? OR instance_id IN (SELECT id FROM card_instances WHERE owner_id=?))').run(id,id,id,id);
  db.prepare('DELETE FROM auction_bids WHERE bidder_id=?').run(id);
  if(ownListingIds.length){const marks=ownListingIds.map(()=>'?').join(',');db.prepare(`DELETE FROM auction_bids WHERE auction_id IN (${marks})`).run(...ownListingIds);db.prepare(`DELETE FROM auction_listings WHERE id IN (${marks})`).run(...ownListingIds)}
  db.prepare('DELETE FROM marketplace_listings WHERE seller_id=? OR buyer_id=? OR instance_id IN (SELECT id FROM card_instances WHERE owner_id=?)').run(id,id,id);
  db.prepare('DELETE FROM drop_history WHERE user_id=? OR instance_id IN (SELECT id FROM card_instances WHERE owner_id=?)').run(id,id);
  db.prepare('DELETE FROM card_instances WHERE owner_id=?').run(id);
  db.prepare('UPDATE card_instances SET booster_id=NULL WHERE booster_id IN (SELECT id FROM booster_openings WHERE user_id=?)').run(id);
  db.prepare('DELETE FROM booster_openings WHERE user_id=?').run(id);
  db.prepare('DELETE FROM wallet_transactions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM notifications WHERE user_id=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  db.exec('COMMIT');return NextResponse.json({ok:true});
 }catch(error){try{db.exec('ROLLBACK')}catch{};return NextResponse.json({error:'Suppression impossible ; aucune modification n’a été appliquée.'},{status:409})}
}
