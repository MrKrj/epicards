import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/local-auth';
import { createCombatProfileForNewCard, db } from '@/lib/local-db';
export const runtime='nodejs';
const schema=z.object({name:z.string().trim().min(2).max(80),description:z.string().trim().min(1).max(1000),category:z.string().trim().min(2).max(60),rarity:z.enum(['Commune','Peu commune','Rare','Épique','Légendaire','Secrète']),collection_value:z.number().int().min(0).max(100000),set_id:z.string().min(1),image_url:z.string().trim().max(500).optional().or(z.literal('')),booster_eligible:z.boolean().default(true)});
export async function POST(request:Request){
  if((await currentUser())?.role!=='admin')return NextResponse.json({error:'Accès administrateur requis.'},{status:403});
  const parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message??'Carte invalide.'},{status:400});
  const data=parsed.data;
  if(!db.prepare('SELECT 1 FROM card_sets WHERE id=?').get(data.set_id))return NextResponse.json({error:'Série inconnue.'},{status:400});
  const id=`card-${crypto.randomUUID()}`;
  try{
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('INSERT INTO cards(id,name,description,category,rarity,collection_value,set_id,image_url,booster_eligible,is_active) VALUES(?,?,?,?,?,?,?,?,?,1)').run(id,data.name,data.description,data.category,data.rarity,data.collection_value,data.set_id,data.image_url||null,Number(data.booster_eligible));
      const combatProfile=createCombatProfileForNewCard(id);
      db.exec('COMMIT');
      return NextResponse.json({ok:true,id,combatProfile});
    }catch(error){try{db.exec('ROLLBACK')}catch{}throw error}
  }catch(error){
    console.error(error);
    return NextResponse.json({error:'Impossible de créer la carte et son profil de combat.'},{status:500});
  }
}
