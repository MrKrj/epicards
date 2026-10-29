import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';

export const runtime = 'nodejs';

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Connexion requise.' }, { status: 401 });

  const result = db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL')
    .run(Date.now(), user.id);

  return NextResponse.json({ ok: true, updated: Number(result.changes) });
}
