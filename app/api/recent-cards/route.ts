import { NextResponse } from 'next/server';
import { db } from '@/lib/local-db';
export const runtime='nodejs';
export async function GET(){
 const acquisitions=db.prepare(`SELECT dh.instance_id,c.id,c.name,c.description,c.rarity,c.category,c.collection_value,c.image_url,c.set_id,s.name AS set_name,u.username,dh.created_at,i.is_shiny
 FROM drop_history dh JOIN card_instances i ON i.id=dh.instance_id JOIN cards c ON c.id=i.card_id JOIN card_sets s ON s.id=c.set_id JOIN users u ON u.id=dh.user_id
 WHERE (c.rarity IN ('Épique','Légendaire','Secrète') OR i.is_shiny=1)
 ORDER BY dh.created_at DESC,dh.id DESC LIMIT 100`).all();
 return NextResponse.json({acquisitions});
}
