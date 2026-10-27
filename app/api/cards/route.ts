import { NextResponse } from 'next/server';
import { db } from '@/lib/local-db';
export const runtime='nodejs';
export async function GET(){const cards=db.prepare(`SELECT c.id,c.name,c.description,c.rarity,c.category,c.collection_value,c.set_id,c.image_url,s.name AS set_name
 FROM cards c JOIN card_sets s ON s.id=c.set_id WHERE c.is_active=1 AND s.is_active=1 ORDER BY s.name,c.rowid LIMIT 500`).all();return NextResponse.json({cards});}
