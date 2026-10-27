import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPasswordHash, db, newSession, userDto, type LocalUser } from '@/lib/local-db';
import { setSessionCookie } from '@/lib/local-auth';
export const runtime = 'nodejs';
const schema = z.object({email:z.string().email().max(254).refine((email)=>email.toLowerCase().endsWith('@epitech.eu'),'Utilise une adresse e-mail @epitech.eu.'),password:z.string().min(8).max(128),username:z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_-]+$/)});
export async function POST(request: Request) {
  const parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message??'Données invalides.'},{status:400});
  const {email,password,username}=parsed.data;
  try {
    const now=Date.now();
    const result=db.prepare('INSERT INTO users(username,email,password_hash,points,created_at) VALUES(?,?,?,500,?)').run(username,email.toLowerCase(),createPasswordHash(password),now);
    db.prepare('INSERT INTO wallet_transactions(user_id,amount,balance_after,reason,created_at) VALUES(?,500,500,?,?)').run(Number(result.lastInsertRowid),'bonus_initial',now);
    const user=db.prepare('SELECT id,username,role,points,created_at FROM users WHERE id=?').get(Number(result.lastInsertRowid)) as LocalUser;
    const response=NextResponse.json({user:userDto(user)});setSessionCookie(response,newSession(user.id));return response;
  } catch(error) {
    const message=String(error);
    if(message.includes('users.username'))return NextResponse.json({error:'Ce pseudo est déjà utilisé.'},{status:409});
    if(message.includes('users.email'))return NextResponse.json({error:'Un compte utilise déjà cette adresse e-mail.'},{status:409});
    return NextResponse.json({error:'Impossible de créer le compte.'},{status:500});
  }
}
