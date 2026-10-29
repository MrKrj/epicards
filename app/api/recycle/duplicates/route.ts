import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';
import { settleExpiredAuctions } from '@/lib/auctions';
import { getRecycleValue } from '@/lib/recycle-values';

export const runtime='nodejs';
const raritySchema=z.array(z.enum(['Commune','Peu commune','Rare','Épique','Légendaire','Secrète'])).min(1).max(6);
const schema=z.union([
 z.object({boosterId:z.string().uuid()}),
 z.object({rarities:raritySchema,excludeShiny:z.boolean().optional().default(false)})
]);

export async function POST(request:Request){
 const user=await currentUser();if(!user)return NextResponse.json({error:'Connexion requise.'},{status:401});
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Sélection de raretés invalide.'},{status:400});
 settleExpiredAuctions();db.exec('BEGIN IMMEDIATE');
 try{
  type RecycleRow={id:string;card_id:string;rarity:string;is_shiny:number};
  let ids:string[]=[];
  let selectedRows:RecycleRow[]=[];
  const byRarity:Record<string,number>={};
  if('boosterId' in parsed.data){
   const {boosterId}=parsed.data;
   const booster=db.prepare('SELECT 1 FROM booster_openings WHERE id=? AND user_id=?').get(boosterId,user.id);
   if(!booster){db.exec('ROLLBACK');return NextResponse.json({error:'Booster introuvable.'},{status:404})}
   selectedRows=db.prepare(`SELECT ci.id,ci.card_id,c.rarity,ci.is_shiny
    FROM card_instances ci JOIN cards c ON c.id=ci.card_id
    WHERE ci.booster_id=? AND ci.owner_id=? AND ci.recycled_at IS NULL AND ci.is_shiny=0
      AND c.rarity IN ('Commune','Peu commune')
      AND EXISTS (SELECT 1 FROM card_instances prior
        WHERE prior.owner_id=ci.owner_id AND prior.card_id=ci.card_id AND prior.is_shiny=0
          AND prior.recycled_at IS NULL AND prior.id<>ci.id
          AND (prior.booster_id IS NULL OR prior.booster_id<>?))
      AND NOT EXISTS (SELECT 1 FROM auction_listings active WHERE active.instance_id=ci.id AND active.status='active')
    ORDER BY ci.card_id,ci.obtained_at,ci.id`).all(boosterId,user.id,boosterId) as RecycleRow[];
   ids=selectedRows.map(row=>row.id);
   for(const row of selectedRows)byRarity[row.rarity]=(byRarity[row.rarity]??0)+1;
  }else{
   const placeholders=parsed.data.rarities.map(()=>'?').join(',');
   const rows=db.prepare(`SELECT ci.id,ci.card_id,c.rarity,ci.is_shiny FROM card_instances ci JOIN cards c ON c.id=ci.card_id WHERE ci.owner_id=? AND ci.recycled_at IS NULL AND c.rarity IN (${placeholders}) AND ci.is_shiny=0 AND NOT EXISTS (SELECT 1 FROM auction_listings active JOIN card_instances listed ON listed.id=active.instance_id WHERE active.seller_id=? AND active.status='active' AND listed.card_id=ci.card_id AND listed.is_shiny=ci.is_shiny) ORDER BY ci.card_id,ci.is_shiny,ci.obtained_at,ci.id`).all(user.id,...parsed.data.rarities,user.id) as RecycleRow[];
   const seen=new Set<string>();
   for(const row of rows){const key=`${row.card_id}:${row.is_shiny?1:0}`;if(seen.has(key)){ids.push(row.id);selectedRows.push(row);byRarity[row.rarity]=(byRarity[row.rarity]??0)+1}else seen.add(key)}
  }
  if(ids.length===0){db.exec('ROLLBACK');return NextResponse.json({error:'Aucun doublon à recycler pour les raretés sélectionnées.'},{status:400})}
  const earned=selectedRows.reduce((sum,row)=>sum+getRecycleValue(row.rarity,Boolean(row.is_shiny)),0);
  const balance=(db.prepare('SELECT points FROM users WHERE id=?').get(user.id) as {points:number}).points+earned,now=Date.now();
  const update=db.prepare('UPDATE card_instances SET recycled_at=? WHERE id=? AND owner_id=? AND recycled_at IS NULL');
  for(const id of ids)update.run(now,id,user.id);
  db.prepare('UPDATE users SET points=? WHERE id=?').run(balance,user.id);
  db.prepare('INSERT INTO wallet_transactions(user_id,amount,balance_after,reason,created_at) VALUES(?,?,?,?,?)').run(user.id,earned,balance,`Recyclage de ${ids.length} doublon(s)`,now);
  db.exec('COMMIT');return NextResponse.json({earned,balance,recycled:ids.length,byRarity});
 }catch(error){try{db.exec('ROLLBACK')}catch{};console.error(error);return NextResponse.json({error:'Recyclage des doublons impossible.'},{status:500})}
}
