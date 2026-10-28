import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';
import { settleExpiredAuctions } from '@/lib/auctions';
export const runtime='nodejs';
const values:Record<string,number>={Commune:5,'Peu commune':10,Rare:30,'Épique':100,'Légendaire':250,Secrète:500};
const schema=z.object({instanceIds:z.array(z.string().uuid()).min(1).max(500)});
export async function POST(request:Request){
 const user=await currentUser();if(!user)return NextResponse.json({error:'Connexion requise.'},{status:401});
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Sélection de cartes invalide.'},{status:400});
 settleExpiredAuctions();db.exec('BEGIN IMMEDIATE');try{
  const ids=[...new Set(parsed.data.instanceIds)];if(ids.length!==parsed.data.instanceIds.length){db.exec('ROLLBACK');return NextResponse.json({error:'Un exemplaire ne peut être recyclé qu’une fois.'},{status:400});}
  const reserved=ids.some(id=>db.prepare("SELECT 1 FROM auction_listings WHERE instance_id=? AND status='active'").get(id));if(reserved){db.exec('ROLLBACK');return NextResponse.json({error:'Une carte engagée dans une enchère ne peut pas être recyclée.'},{status:409});}
  const rows=ids.map(id=>db.prepare(`SELECT ci.id,c.rarity,ci.is_shiny FROM card_instances ci JOIN cards c ON c.id=ci.card_id WHERE ci.id=? AND ci.owner_id=? AND ci.recycled_at IS NULL`).get(id,user.id) as {id:string;rarity:string;is_shiny:number}|undefined);
  if(rows.some(row=>!row)){db.exec('ROLLBACK');return NextResponse.json({error:'Un exemplaire sélectionné est indisponible.'},{status:409});}
  const earned=rows.reduce((sum,row)=>sum+(values[row!.rarity]??0)*(row!.is_shiny?10:1),0),balance=(db.prepare('SELECT points FROM users WHERE id=?').get(user.id) as {points:number}).points+earned,now=Date.now();
  for(const id of ids)db.prepare('UPDATE card_instances SET recycled_at=? WHERE id=? AND owner_id=? AND recycled_at IS NULL').run(now,id,user.id);
  db.prepare('UPDATE users SET points=? WHERE id=?').run(balance,user.id);db.prepare('INSERT INTO wallet_transactions(user_id,amount,balance_after,reason,created_at) VALUES(?,?,?,?,?)').run(user.id,earned,balance,`Recyclage de ${ids.length} carte(s)`,now);db.exec('COMMIT');return NextResponse.json({earned,balance,recycled:ids.length});
 }catch(error){try{db.exec('ROLLBACK')}catch{};console.error(error);return NextResponse.json({error:'Recyclage impossible.'},{status:500});}
}
