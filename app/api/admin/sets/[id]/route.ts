import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';
export const runtime='nodejs';
const schema=z.object({name:z.string().trim().min(2).max(60),description:z.string().trim().max(500).default(''),color:z.string().regex(/^#[0-9a-fA-F]{6}$/,'Choisis une couleur valide.')});
async function allowed(){return (await currentUser())?.role==='admin'}
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){if(!await allowed())return NextResponse.json({error:'Accès administrateur requis.'},{status:403});const {id}=await params;const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Nom, description ou couleur invalide.'},{status:400});try{const result=db.prepare('UPDATE card_sets SET name=?,description=?,color=? WHERE id=? AND is_active=1').run(parsed.data.name,parsed.data.description,parsed.data.color,id);return result.changes?NextResponse.json({ok:true}):NextResponse.json({error:'Série introuvable.'},{status:404})}catch{return NextResponse.json({error:'Une série porte déjà ce nom.'},{status:409})}}
export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){
 if(!await allowed())return NextResponse.json({error:'Accès administrateur requis.'},{status:403});
 const {id}=await params;const set=db.prepare('SELECT is_default FROM card_sets WHERE id=? AND is_active=1').get(id) as {is_default:number}|undefined;
 if(!set)return NextResponse.json({error:'Série introuvable.'},{status:404});if(set.is_default)return NextResponse.json({error:'La série par défaut ne peut pas être supprimée.'},{status:409});
 const cards=db.prepare('SELECT id FROM cards WHERE set_id=?').all(id) as Array<{id:string}>;
 db.exec('BEGIN IMMEDIATE');try{const hasInventory=cards.some(card=>(db.prepare('SELECT 1 FROM card_instances WHERE card_id=? LIMIT 1').get(card.id)));if(hasInventory){db.prepare('UPDATE cards SET is_active=0 WHERE set_id=?').run(id);db.prepare('UPDATE card_sets SET is_active=0 WHERE id=?').run(id);db.exec('COMMIT');return NextResponse.json({ok:true,archived:true})}db.prepare('DELETE FROM cards WHERE set_id=?').run(id);db.prepare('DELETE FROM card_sets WHERE id=?').run(id);db.exec('COMMIT');return NextResponse.json({ok:true,archived:false})}catch(error){db.exec('ROLLBACK');throw error}
}
