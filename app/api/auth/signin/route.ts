import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, newSession, userDto, verifyPassword, type LocalUser } from '@/lib/local-db';
import { setSessionCookie } from '@/lib/local-auth';
export const runtime = 'nodejs';
const schema=z.object({email:z.string().email(),password:z.string().min(1)});
export async function POST(request:Request){
 const parsed=schema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:'Adresse e-mail ou mot de passe invalide.'},{status:400});
 const user=db.prepare('SELECT id,username,role,points,created_at,password_hash FROM users WHERE email=? COLLATE NOCASE').get(parsed.data.email) as (LocalUser&{password_hash:string})|undefined;
 if(!user||!verifyPassword(parsed.data.password,user.password_hash))return NextResponse.json({error:'Adresse e-mail ou mot de passe incorrect.'},{status:401});
 const response=NextResponse.json({user:userDto(user)});setSessionCookie(response,newSession(user.id));return response;
}
