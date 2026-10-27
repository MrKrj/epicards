import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';
export const runtime='nodejs';
const schema=z.object({name:z.string().trim().min(2).max(60),description:z.string().trim().max(500).default(''),color:z.string().regex(/^#[0-9a-fA-F]{6}$/,'Choisis une couleur valide.')});
async function admin(){const user=await currentUser();return user?.role==='admin'?user:null}
export async function POST(request:Request){
 if(!await admin())return NextResponse.json({error:'Accès administrateur requis.'},{status:403});
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Nom ou description invalide.'},{status:400});
 const id=`set-${parsed.data.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}-${crypto.randomUUID().slice(0,6)}`;
 try{db.prepare('INSERT INTO card_sets(id,name,description,is_default,color) VALUES(?,?,?,0,?)').run(id,parsed.data.name,parsed.data.description,parsed.data.color);return NextResponse.json({ok:true,id})}catch{return NextResponse.json({error:'Une série porte déjà ce nom.'},{status:409})}
}
