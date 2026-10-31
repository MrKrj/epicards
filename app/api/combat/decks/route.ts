import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';
import { combatDeckInputSchema, validateOwnedCombatDeck } from '@/lib/combat-decks';
import { CombatRuleError } from '@/lib/combat-engine';

export const runtime='nodejs';

export async function POST(request:Request){
  const user=await currentUser();
  if(!user)return NextResponse.json({error:'Connecte-toi pour enregistrer un deck.'},{status:401});
  const parsed=combatDeckInputSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message??'Deck invalide.'},{status:400});
  const {name,cards}=parsed.data;
  try{
    validateOwnedCombatDeck(user.id,cards);
    db.exec('BEGIN IMMEDIATE');
    try{
      const count=db.prepare('SELECT COUNT(*) AS total FROM combat_decks WHERE user_id=?').get(user.id) as {total:number};
      if(count.total>=12)throw new CombatRuleError('Tu peux enregistrer jusqu’à 12 decks. Supprime-en un avant d’en créer un autre.');
      const id=randomUUID(),now=Date.now();
      db.prepare('INSERT INTO combat_decks(id,user_id,name,cards_json,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,user.id,name,JSON.stringify(cards),now,now);
      db.exec('COMMIT');
      return NextResponse.json({ok:true,deck:{id,name,cards,updatedAt:now}},{status:201});
    }catch(error){try{db.exec('ROLLBACK')}catch{}throw error}
  }catch(error){
    if(error instanceof CombatRuleError)return NextResponse.json({error:error.message},{status:400});
    if(error instanceof Error&&error.message.includes('UNIQUE constraint failed'))return NextResponse.json({error:'Tu as déjà un deck avec ce nom.'},{status:409});
    console.error(error);return NextResponse.json({error:'Impossible d’enregistrer le deck.'},{status:500});
  }
}
