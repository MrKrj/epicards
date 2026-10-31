import { randomInt } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';
import { CombatRuleError, combatSnapshot, createCombatState, makeAllUnplayedCardsAvailable, passCombatRound, playCombatCard, resolveComputerTurn, validateCombatDeck, type CombatCard, type CombatState } from '@/lib/combat-engine';
import { getCombatProfile, type CombatRoleId } from '@/lib/combat-profiles';

export const runtime = 'nodejs';

const cardRefs=z.array(z.object({cardId:z.string().min(1).max(100),isShiny:z.boolean()}).strict()).min(8).max(12);
const actionSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('join'),cards:cardRefs}).strict(),
  z.object({action:z.literal('decline')}).strict(),
  z.object({action:z.literal('cancel')}).strict(),
  z.object({action:z.literal('play'),cardId:z.string().min(1).max(100),row:z.enum(['melee','ranged','siege'])}).strict(),
  z.object({action:z.literal('pass')}).strict(),
  z.object({action:z.literal('daemon')}).strict(),
]);
type MatchRow={id:string;mode:'ai'|'pvp';status:string;player1_id:number;player2_id:number|null;player1_deck:string;player2_deck:string|null;state_json:string|null;created_at:number;updated_at:number;finished_at:number|null;player1_name:string;player2_name:string|null};
type CardRow={id:string;name:string;rarity:string;category:string;set_id:string;set_name:string;image_url:string|null;is_shiny:number;role_id?:CombatRoleId|null;combat_power?:number|null;stability?:number|null;expertise?:number|null};
function toCombatCard(row:CardRow):CombatCard{
  const combatProfile=row.role_id&&row.combat_power!==null&&row.combat_power!==undefined&&row.stability!==null&&row.stability!==undefined&&row.expertise!==null&&row.expertise!==undefined
    ? {role:row.role_id,power:row.combat_power,stability:row.stability,expertise:row.expertise}:undefined;
  return{id:row.id,name:row.name,rarity:row.rarity,category:row.category,setId:row.set_id,setName:row.set_name,imageUrl:row.image_url,isShiny:Boolean(row.is_shiny),combatProfile:getCombatProfile({id:row.id,combatProfile})};
}
function loadOwnedDeck(userId:number,refs:z.infer<typeof cardRefs>):CombatCard[]{
  const get=db.prepare(`SELECT c.id,c.name,c.rarity,c.category,c.set_id,s.name AS set_name,c.image_url,ci.is_shiny,
      cp.role_id,cp.power AS combat_power,cp.stability,cp.expertise
    FROM card_instances ci JOIN cards c ON c.id=ci.card_id JOIN card_sets s ON s.id=c.set_id
    LEFT JOIN card_combat_profiles cp ON cp.card_id=c.id
    WHERE ci.owner_id=? AND ci.card_id=? AND ci.is_shiny=? AND ci.recycled_at IS NULL AND c.is_active=1 LIMIT 1`);
  const deck=refs.map(ref=>{const card=get.get(userId,ref.cardId,ref.isShiny?1:0) as CardRow|undefined;if(!card)throw new CombatRuleError('Une carte sélectionnée n’est plus dans ta collection.');return toCombatCard(card)});
  const issue=validateCombatDeck(deck);if(issue)throw new CombatRuleError(issue);return deck;
}
function loadMatch(id:string):MatchRow|undefined{
  return db.prepare(`SELECT m.*,p1.username AS player1_name,p2.username AS player2_name FROM combat_matches m
    JOIN users p1 ON p1.id=m.player1_id LEFT JOIN users p2 ON p2.id=m.player2_id WHERE m.id=?`).get(id) as MatchRow|undefined;
}
function viewerSide(match:MatchRow,userId:number){return match.player1_id===userId?'p1':'p2' as const}
function makeState(match:MatchRow,deck2:CombatCard[]):CombatState{
  const player1=db.prepare('SELECT id,username FROM users WHERE id=?').get(match.player1_id) as {id:number;username:string};
  const player2=db.prepare('SELECT id,username FROM users WHERE id=?').get(match.player2_id) as {id:number;username:string};
  const deck1=JSON.parse(match.player1_deck) as CombatCard[];
  return createCombatState({mode:'pvp',player1,player2,deck1,deck2,randomIndex:randomInt});
}

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  const user=await currentUser();if(!user)return NextResponse.json({error:'Connexion requise.'},{status:401});
  const {id}=await params;const match=loadMatch(id);
  if(!match)return NextResponse.json({error:'Combat introuvable.'},{status:404});
  if(match.player1_id!==user.id&&match.player2_id!==user.id)return NextResponse.json({error:'Ce combat ne t’est pas destiné.'},{status:403});
  if(match.mode==='pvp')return NextResponse.json({error:'Le combat entre joueurs est temporairement inaccessible.'},{status:503});
  const viewer=viewerSide(match,user.id);
  const response:{match:unknown;state:unknown}={match:{id:match.id,mode:match.mode,status:match.status,player1:{id:match.player1_id,username:match.player1_name},player2:match.player2_id===null?{id:null,username:'Daemon du campus'}:{id:match.player2_id,username:match.player2_name},createdAt:match.created_at,updatedAt:match.updated_at},state:null};
  if(match.state_json){try{response.state=combatSnapshot(JSON.parse(match.state_json) as CombatState,viewer)}catch(error){console.error(error);return NextResponse.json({error:'État du combat illisible.'},{status:500})}}
  return NextResponse.json(response,{headers:{'Cache-Control':'no-store'}});
}

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  const user=await currentUser();if(!user)return NextResponse.json({error:'Connexion requise.'},{status:401});
  const parsed=actionSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Action de combat invalide.'},{status:400});
  const {id}=await params;const now=Date.now();
  try{
    db.exec('BEGIN IMMEDIATE');
    try{
      const match=loadMatch(id);if(!match)throw new CombatRuleError('Combat introuvable.');
      if(match.player1_id!==user.id&&match.player2_id!==user.id)throw new CombatRuleError('Ce combat ne t’est pas destiné.');
      const action=parsed.data;
      if(match.mode==='pvp'&&action.action!=='decline'&&action.action!=='cancel')throw new CombatRuleError('Le combat entre joueurs est temporairement inaccessible.');
      if(action.action==='decline'||action.action==='cancel'){
        const canChange=match.status==='waiting'&&(action.action==='decline'?match.player2_id===user.id:match.player1_id===user.id);
        if(!canChange)throw new CombatRuleError('Cette invitation ne peut plus être modifiée.');
        const nextStatus=action.action==='decline'?'declined':'cancelled';
        db.prepare('UPDATE combat_matches SET status=?,updated_at=? WHERE id=? AND status=\'waiting\'').run(nextStatus,now,id);
        db.exec('COMMIT');return NextResponse.json({ok:true,status:nextStatus});
      }
      if(action.action==='join'){
        if(match.status!=='waiting'||match.player2_id!==user.id)throw new CombatRuleError('Cette invitation n’est plus disponible.');
        const deck2=loadOwnedDeck(user.id,action.cards);
        const state=makeState(match,deck2);
        db.prepare("UPDATE combat_matches SET status='active',player2_deck=?,state_json=?,updated_at=? WHERE id=? AND status='waiting'").run(JSON.stringify(deck2),JSON.stringify(state),now,id);
        db.exec('COMMIT');return NextResponse.json({ok:true,status:'active'});
      }
      if(match.status!=='active'||!match.state_json)throw new CombatRuleError('Ce combat n’est pas en cours.');
      const state=makeAllUnplayedCardsAvailable(JSON.parse(match.state_json) as CombatState);const side=viewerSide(match,user.id);
      if(action.action==='daemon'){
        if(match.mode!=='ai'||match.player1_id!==user.id||side!=='p1'||state.turn!=='p2')throw new CombatRuleError('Le Daemon ne peut pas jouer maintenant.');
        resolveComputerTurn(state,randomInt);
      }else if(action.action==='play')playCombatCard(state,side,action.cardId,action.row);
      else passCombatRound(state,side);
      const status=state.status;
      db.prepare('UPDATE combat_matches SET status=?,state_json=?,updated_at=?,finished_at=? WHERE id=? AND status=\'active\'')
        .run(status,JSON.stringify(state),now,status==='finished'?now:null,id);
      db.exec('COMMIT');
      return NextResponse.json({ok:true,status,state:combatSnapshot(state,side)},{headers:{'Cache-Control':'no-store'}});
    }catch(error){try{db.exec('ROLLBACK')}catch{}throw error}
  }catch(error){
    if(error instanceof CombatRuleError){const status=error.message==='Combat introuvable.'?404:error.message==='Ce combat ne t’est pas destiné.'?403:409;return NextResponse.json({error:error.message},{status})}
    console.error(error);return NextResponse.json({error:'Impossible d’appliquer cette action.'},{status:500});
  }
}
