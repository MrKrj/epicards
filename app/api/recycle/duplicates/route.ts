import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';
import { settleExpiredAuctions } from '@/lib/auctions';

export const runtime='nodejs';
const values:Record<string,number>={Commune:5,'Peu commune':10,Rare:30,'Épique':100,'Légendaire':250,Secrète:500};
const schema=z.object({rarities:z.array(z.enum(['Commune','Peu commune','Rare','Épique','Légendaire','Secrète'])).min(1).max(6),excludeShiny:z.boolean().optional().default(false)});

export async function POST(request:Request){
 const user=await currentUser();if(!user)return NextResponse.json({error:'Connexion requise.'},{status:401});
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Sélection de raretés invalide.'},{status:400});
 settleExpiredAuctions();db.exec('BEGIN IMMEDIATE');
 try{
  const placeholders=parsed.data.rarities.map(()=>'?').join(','),nonShinyClause=parsed.data.excludeShiny?' AND ci.is_shiny=0':'';
  const rows=db.prepare(`SELECT ci.id,ci.card_id,c.rarity,ci.is_shiny FROM card_instances ci JOIN cards c ON c.id=ci.card_id WHERE ci.owner_id=? AND ci.recycled_at IS NULL AND c.rarity IN (${placeholders})${nonShinyClause} AND NOT EXISTS (SELECT 1 FROM auction_listings active JOIN card_instances listed ON listed.id=active.instance_id WHERE active.seller_id=? AND active.status='active' AND listed.card_id=ci.card_id AND listed.is_shiny=ci.is_shiny) ORDER BY ci.card_id,ci.is_shiny,ci.obtained_at,ci.id`).all(user.id,...parsed.data.rarities,user.id) as Array<{id:string;card_id:string;rarity:string;is_shiny:number}>;
  const seen=new Set<string>(),ids:string[]=[],selectedRows:typeof rows=[],byRarity:Record<string,number>={};
  for(const row of rows){const key=`${row.card_id}:${row.is_shiny?1:0}`;if(seen.has(key)){ids.push(row.id);selectedRows.push(row);byRarity[row.rarity]=(byRarity[row.rarity]??0)+1}else seen.add(key)}
  if(ids.length===0){db.exec('ROLLBACK');return NextResponse.json({error:'Aucun doublon à recycler pour les raretés sélectionnées.'},{status:400})}
  const earned=selectedRows.reduce((sum,row)=>sum+(values[row.rarity]??0)*(row.is_shiny?10:1),0);
  const balance=(db.prepare('SELECT points FROM users WHERE id=?').get(user.id) as {points:number}).points+earned,now=Date.now();
  const update=db.prepare('UPDATE card_instances SET recycled_at=? WHERE id=? AND owner_id=? AND recycled_at IS NULL');
  for(const id of ids)update.run(now,id,user.id);
  db.prepare('UPDATE users SET points=? WHERE id=?').run(balance,user.id);
  db.prepare('INSERT INTO wallet_transactions(user_id,amount,balance_after,reason,created_at) VALUES(?,?,?,?,?)').run(user.id,earned,balance,`Recyclage de ${ids.length} doublon(s)`,now);
  db.exec('COMMIT');return NextResponse.json({earned,balance,recycled:ids.length,byRarity});
 }catch(error){try{db.exec('ROLLBACK')}catch{};console.error(error);return NextResponse.json({error:'Recyclage des doublons impossible.'},{status:500})}
}
