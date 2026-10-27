import { NextResponse } from 'next/server';
import { db } from '@/lib/local-db';
export const runtime='nodejs';
export async function GET(){const collections=db.prepare(`SELECT s.id,s.name,s.description,s.is_default,s.color,COUNT(c.id) AS card_count FROM card_sets s LEFT JOIN cards c ON c.set_id=s.id AND c.is_active=1 WHERE s.is_active=1 GROUP BY s.id ORDER BY s.is_default DESC,s.name`).all();return NextResponse.json({collections});}
