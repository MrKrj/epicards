import { cookies } from 'next/headers';
import { db, hashToken, type LocalUser } from '@/lib/local-db';

export const SESSION_COOKIE = 'cardverse_session';
export async function currentUser(): Promise<LocalUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  return (db.prepare(`SELECT users.id,users.username,users.role,users.points,users.created_at
    FROM sessions JOIN users ON users.id=sessions.user_id
    WHERE sessions.token_hash=? AND sessions.expires_at>?`).get(hashToken(token),now) as LocalUser | undefined) ?? null;
}
export function setSessionCookie(response: import('next/server').NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:30*24*60*60});
}
export async function clearSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
}
