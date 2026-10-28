import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/local-auth';
import { createPasswordHash, db } from '@/lib/local-db';

export const runtime='nodejs';
const usernameSchema=z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_-]+$/,'Le pseudo doit faire 3 à 24 caractères et ne contenir que lettres, chiffres, _ ou -.');
const createSchema=z.object({username:usernameSchema,email:z.string().email().max(254).refine(value=>value.toLowerCase().endsWith('@epitech.eu'),'Utilise une adresse @epitech.eu.'),password:z.string().min(8).max(128),points:z.number().int().min(0).max(1_000_000).default(500)});

async function admin(){return (await currentUser())?.role==='admin'}

export async function GET(){
 if(!await admin())return NextResponse.json({error:'Accès administrateur requis.'},{status:403});
 const users=db.prepare(`SELECT u.id,u.username,u.email,u.role,u.points,u.created_at,
   COUNT(DISTINCT CASE WHEN ci.recycled_at IS NULL THEN ci.card_id END) AS distinct_cards,
   COUNT(CASE WHEN ci.recycled_at IS NULL THEN ci.id END) AS total_cards
   FROM users u LEFT JOIN card_instances ci ON ci.owner_id=u.id GROUP BY u.id ORDER BY u.username COLLATE NOCASE`).all();
 return NextResponse.json({users});
}

export async function POST(request:Request){
 if(!await admin())return NextResponse.json({error:'Accès administrateur requis.'},{status:403});
 const parsed=createSchema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message??'Données invalides.'},{status:400});
 const {username,email,password,points}=parsed.data,now=Date.now();
 try{
  db.exec('BEGIN IMMEDIATE');
  const result=db.prepare("INSERT INTO users(username,email,password_hash,role,points,created_at) VALUES(?,?,?,'player',?,?)").run(username,email.toLowerCase(),createPasswordHash(password),points,now);
  const id=Number(result.lastInsertRowid);
  if(points>0)db.prepare('INSERT INTO wallet_transactions(user_id,amount,balance_after,reason,created_at) VALUES(?,?,?, ?,?)').run(id,points,points,'création_compte_admin',now);
  db.exec('COMMIT');
  return NextResponse.json({ok:true,id});
 }catch(error){try{db.exec('ROLLBACK')}catch{};const message=String(error);if(message.includes('users.username'))return NextResponse.json({error:'Ce pseudo est déjà utilisé.'},{status:409});if(message.includes('users.email'))return NextResponse.json({error:'Cette adresse e-mail est déjà utilisée.'},{status:409});return NextResponse.json({error:'Impossible de créer le compte.'},{status:500})}
}
