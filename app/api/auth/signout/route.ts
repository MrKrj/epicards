import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db, hashToken } from '@/lib/local-db';
import { SESSION_COOKIE } from '@/lib/local-auth';
export const runtime='nodejs';
export async function POST(){const token=(await cookies()).get(SESSION_COOKIE)?.value;if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));const response=NextResponse.json({ok:true});response.cookies.set(SESSION_COOKIE,'',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:0});return response;}
