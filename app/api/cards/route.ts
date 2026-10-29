import { NextResponse } from 'next/server';
import { db } from '@/lib/local-db';
export const runtime='nodejs';
export async function GET(){const cards=db.prepare(`SELECT c.id,c.name,c.description,c.rarity,c.category,c.collection_value,c.set_id,c.image_url,c.booster_eligible,s.name AS set_name,s.is_default AS set_is_default
 FROM cards c JOIN card_sets s ON s.id=c.set_id WHERE c.is_active=1 AND s.is_active=1
 ORDER BY s.is_default DESC,s.name COLLATE NOCASE,
  CASE c.rarity WHEN 'Commune' THEN 0 WHEN 'Peu commune' THEN 1 WHEN 'Rare' THEN 2 WHEN 'Épique' THEN 3 WHEN 'Légendaire' THEN 4 WHEN 'Secrète' THEN 5 ELSE 99 END,
  c.name COLLATE NOCASE LIMIT 500`).all();return NextResponse.json({cards});}
