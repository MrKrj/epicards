import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';
import { randomUUID } from 'node:crypto';

export const runtime='nodejs';
const schema=z.object({cardId:z.string().min(1),quantity:z.number().int().min(1).max(500),isShiny:z.boolean().optional().default(false)});
async function admin(){return (await currentUser())?.role==='admin'}
function parseId(value:string){const id=Number(value);return Number.isSafeInteger(id)&&id>0?id:null}

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 if(!await admin())return NextResponse.json({error:'Accès administrateur requis.'},{status:403});
 const {id:rawId}=await params,userId=parseId(rawId);if(!userId)return NextResponse.json({error:'Utilisateur invalide.'},{status:400});
 if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(userId))return NextResponse.json({error:'Utilisateur introuvable.'},{status:404});
 const ownedCards=db.prepare(`SELECT c.id,c.name,c.description,c.rarity,c.category,c.collection_value,c.image_url,c.set_id,c.booster_eligible,s.name AS set_name,ci.is_shiny,COUNT(ci.id) AS quantity,
  SUM(CASE WHEN NOT EXISTS(SELECT 1 FROM auction_listings a WHERE a.instance_id=ci.id AND a.status='active') THEN 1 ELSE 0 END) AS available_quantity
  FROM card_instances ci JOIN cards c ON c.id=ci.card_id JOIN card_sets s ON s.id=c.set_id
  WHERE ci.owner_id=? AND ci.recycled_at IS NULL GROUP BY c.id,ci.is_shiny
  ORDER BY s.is_default DESC,s.name COLLATE NOCASE,
   CASE c.rarity WHEN 'Commune' THEN 0 WHEN 'Peu commune' THEN 1 WHEN 'Rare' THEN 2 WHEN 'Épique' THEN 3 WHEN 'Légendaire' THEN 4 WHEN 'Secrète' THEN 5 ELSE 99 END,
   ci.is_shiny,c.name COLLATE NOCASE`).all(userId);
 return NextResponse.json({cards:ownedCards});
}

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 if(!await admin())return NextResponse.json({error:'Accès administrateur requis.'},{status:403});
 const {id:rawId}=await params,userId=parseId(rawId);if(!userId)return NextResponse.json({error:'Utilisateur invalide.'},{status:400});
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Carte ou quantité invalide.'},{status:400});
 if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(userId))return NextResponse.json({error:'Utilisateur introuvable.'},{status:404});
 if(!db.prepare('SELECT 1 FROM cards WHERE id=? AND is_active=1').get(parsed.data.cardId))return NextResponse.json({error:'Carte introuvable ou inactive.'},{status:404});
 const add=db.prepare("INSERT INTO card_instances(id,card_id,owner_id,obtained_at,source,is_shiny) VALUES(?,?,?,?,'admin',?)"),now=Date.now();
 try{db.exec('BEGIN IMMEDIATE');for(let i=0;i<parsed.data.quantity;i++)add.run(randomUUID(),parsed.data.cardId,userId,now,parsed.data.isShiny?1:0);db.exec('COMMIT');return NextResponse.json({ok:true,added:parsed.data.quantity,isShiny:parsed.data.isShiny})}catch{try{db.exec('ROLLBACK')}catch{};return NextResponse.json({error:'Attribution des cartes impossible.'},{status:500})}
}

export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){
 if(!await admin())return NextResponse.json({error:'Accès administrateur requis.'},{status:403});
 const {id:rawId}=await params,userId=parseId(rawId);if(!userId)return NextResponse.json({error:'Utilisateur invalide.'},{status:400});
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Carte ou quantité invalide.'},{status:400});
 try{db.exec('BEGIN IMMEDIATE');const available=db.prepare(`SELECT ci.id FROM card_instances ci WHERE ci.owner_id=? AND ci.card_id=? AND ci.recycled_at IS NULL
   AND ci.is_shiny=?
   AND NOT EXISTS(SELECT 1 FROM auction_listings a WHERE a.instance_id=ci.id AND a.status='active') ORDER BY ci.obtained_at DESC LIMIT ?`).all(userId,parsed.data.cardId,parsed.data.isShiny?1:0,parsed.data.quantity) as Array<{id:string}>;
 if(available.length<parsed.data.quantity){db.exec('ROLLBACK');return NextResponse.json({error:`L’utilisateur n’a que ${available.length} exemplaire(s) non engagés de cette carte.`},{status:409});}
 const retire=db.prepare('UPDATE card_instances SET recycled_at=? WHERE id=? AND owner_id=? AND recycled_at IS NULL'),now=Date.now();for(const item of available){const result=retire.run(now,item.id,userId);if(!result.changes)throw new Error('Carte modifiée pendant l’opération.')}db.exec('COMMIT');return NextResponse.json({ok:true,removed:available.length})}catch{try{db.exec('ROLLBACK')}catch{};return NextResponse.json({error:'Retrait des cartes impossible ; aucune modification n’a été appliquée.'},{status:409})}
}
