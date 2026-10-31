import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';
import { combatDeckInputSchema, validateOwnedCombatDeck } from '@/lib/combat-decks';
import { CombatRuleError } from '@/lib/combat-engine';

export const runtime='nodejs';

export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){
  const user=await currentUser();
  if(!user)return NextResponse.json({error:'Connecte-toi pour modifier un deck.'},{status:401});
  const {id}=await params;
  const parsed=combatDeckInputSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message??'Deck invalide.'},{status:400});
  try{
    validateOwnedCombatDeck(user.id,parsed.data.cards);
    const now=Date.now();
    const result=db.prepare('UPDATE combat_decks SET name=?,cards_json=?,updated_at=? WHERE id=? AND user_id=?').run(parsed.data.name,JSON.stringify(parsed.data.cards),now,id,user.id);
    if(!result.changes)return NextResponse.json({error:'Deck introuvable.'},{status:404});
    return NextResponse.json({ok:true,deck:{id,name:parsed.data.name,cards:parsed.data.cards,updatedAt:now}});
  }catch(error){
    if(error instanceof CombatRuleError)return NextResponse.json({error:error.message},{status:400});
    if(error instanceof Error&&error.message.includes('UNIQUE constraint failed'))return NextResponse.json({error:'Tu as déjà un deck avec ce nom.'},{status:409});
    console.error(error);return NextResponse.json({error:'Impossible de modifier le deck.'},{status:500});
  }
}

export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){
  const user=await currentUser();
  if(!user)return NextResponse.json({error:'Connecte-toi pour supprimer un deck.'},{status:401});
  const {id}=await params;
  const result=db.prepare('DELETE FROM combat_decks WHERE id=? AND user_id=?').run(id,user.id);
  return result.changes?NextResponse.json({ok:true}):NextResponse.json({error:'Deck introuvable.'},{status:404});
}
