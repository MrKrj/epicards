import { randomInt, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';
import { CombatRuleError, createCombatState, validateCombatDeck, type CombatCard } from '@/lib/combat-engine';
import { pruneResumableCombatMatches } from '@/lib/combat-match-retention';
import { getCombatProfile, type CombatRoleId } from '@/lib/combat-profiles';

export const runtime = 'nodejs';

const deckSchema = z.array(z.object({ cardId: z.string().min(1).max(100), isShiny: z.boolean() }).strict()).min(8).max(12);
const createSchema = z.object({ mode: z.enum(['ai', 'pvp']), cards: deckSchema, opponentId: z.number().int().positive().optional() }).strict();
const raritySort = "CASE c.rarity WHEN 'Commune' THEN 0 WHEN 'Peu commune' THEN 1 WHEN 'Rare' THEN 2 WHEN 'Épique' THEN 3 WHEN 'Légendaire' THEN 4 WHEN 'Secrète' THEN 5 ELSE 99 END";

type CardRow = { id:string; name:string; rarity:string; category:string; set_id:string; set_name:string; image_url:string|null; is_shiny:number; role_id?:CombatRoleId|null; combat_power?:number|null; stability?:number|null; expertise?:number|null };
function toCombatCard(row: CardRow): CombatCard {
  const combatProfile=row.role_id&&row.combat_power!==null&&row.combat_power!==undefined&&row.stability!==null&&row.stability!==undefined&&row.expertise!==null&&row.expertise!==undefined
    ? {role:row.role_id,power:row.combat_power,stability:row.stability,expertise:row.expertise}:undefined;
  return { id:row.id,name:row.name,rarity:row.rarity,category:row.category,setId:row.set_id,setName:row.set_name,imageUrl:row.image_url,isShiny:Boolean(row.is_shiny),combatProfile:getCombatProfile({id:row.id,combatProfile}) };
}

function ownedDeck(userId: number, refs: z.infer<typeof deckSchema>): CombatCard[] {
  const get = db.prepare(`SELECT c.id,c.name,c.rarity,c.category,c.set_id,s.name AS set_name,c.image_url,ci.is_shiny,
      cp.role_id,cp.power AS combat_power,cp.stability,cp.expertise
    FROM card_instances ci JOIN cards c ON c.id=ci.card_id JOIN card_sets s ON s.id=c.set_id
    LEFT JOIN card_combat_profiles cp ON cp.card_id=c.id
    WHERE ci.owner_id=? AND ci.card_id=? AND ci.is_shiny=? AND ci.recycled_at IS NULL AND c.is_active=1 LIMIT 1`);
  const cards = refs.map(ref => {
    const row = get.get(userId,ref.cardId,ref.isShiny?1:0) as CardRow|undefined;
    if (!row) throw new CombatRuleError('Une carte choisie n’est plus présente dans ta collection. Actualise le deck puis réessaie.');
    return toCombatCard(row);
  });
  const issue = validateCombatDeck(cards);
  if (issue) throw new CombatRuleError(issue);
  return cards;
}

function computerDeck(playerDeck: CombatCard[]): CombatCard[] {
  const rows = db.prepare(`SELECT c.id,c.name,c.rarity,c.category,c.set_id,s.name AS set_name,c.image_url,0 AS is_shiny,
      cp.role_id,cp.power AS combat_power,cp.stability,cp.expertise
    FROM cards c JOIN card_sets s ON s.id=c.set_id LEFT JOIN card_combat_profiles cp ON cp.card_id=c.id
    WHERE c.is_active=1 AND c.rarity<>'Secrète'
    ORDER BY ${raritySort},c.name COLLATE NOCASE`).all() as CardRow[];
  const all = [...rows.map(toCombatCard),...playerDeck.filter(card=>card.rarity!=='Secrète')];
  const distinct = [...new Map(all.map(card=>[`${card.id}:0`,{...card,isShiny:false}])).values()];
  const randomOrder = <T,>(items:T[]) => {const copy=[...items];for(let i=copy.length-1;i>0;i--){const j=randomInt(i+1);[copy[i],copy[j]]=[copy[j],copy[i]]}return copy};
  const shuffled = randomOrder(distinct);
  const target = playerDeck.length;
  const selected:CombatCard[]=[];
  const used = new Set<string>();
  for(const rarity of ['Rare','Épique','Légendaire']){
    const candidate=shuffled.find(card=>card.rarity===rarity&&!used.has(card.id));
    if(candidate&&selected.length<target){selected.push(candidate);used.add(candidate.id)}
  }
  for(const rarity of ['Commune','Peu commune','Rare','Épique','Légendaire']){
    for(const candidate of shuffled.filter(card=>card.rarity===rarity&&!used.has(card.id))){
      if(selected.length>=target)break;
      selected.push(candidate);used.add(candidate.id);
    }
    if(selected.length>=target)break;
  }
  if(selected.length<8)throw new CombatRuleError('Il n’y a pas assez de cartes actives pour lancer un combat contre l’IA.');
  return selected;
}

export async function GET() {
  const user=await currentUser();
  if(!user)return NextResponse.json({error:'Connecte-toi pour accéder au combat.'},{status:401});
  const cards=db.prepare(`SELECT c.id,c.name,c.rarity,c.category,c.set_id,s.name AS set_name,c.image_url,ci.is_shiny,COUNT(*) AS quantity,
      cp.role_id,cp.power AS combat_power,cp.stability,cp.expertise
    FROM card_instances ci JOIN cards c ON c.id=ci.card_id JOIN card_sets s ON s.id=c.set_id
    LEFT JOIN card_combat_profiles cp ON cp.card_id=c.id
    WHERE ci.owner_id=? AND ci.recycled_at IS NULL AND c.is_active=1
    GROUP BY c.id,ci.is_shiny,cp.card_id ORDER BY ${raritySort},c.name COLLATE NOCASE`).all(user.id) as Array<CardRow&{quantity:number}>;
  const players=db.prepare("SELECT id,username FROM users WHERE id<>? AND role='player' ORDER BY username COLLATE NOCASE LIMIT 300").all(user.id);
  const matches=db.prepare(`SELECT m.id,m.mode,m.status,m.player1_id,m.player2_id,m.created_at,m.updated_at,
      p1.username AS player1_name,p2.username AS player2_name
    FROM combat_matches m JOIN users p1 ON p1.id=m.player1_id LEFT JOIN users p2 ON p2.id=m.player2_id
    WHERE (m.player1_id=? OR m.player2_id=?) AND (m.status IN ('waiting','active') OR m.id IN (
      SELECT h.id FROM combat_matches h WHERE (h.player1_id=? OR h.player2_id=?)
        AND h.status IN ('finished','declined','cancelled') ORDER BY h.updated_at DESC LIMIT 24
    )) ORDER BY m.updated_at DESC`).all(user.id,user.id,user.id,user.id);
  const finishedMatches=db.prepare(`SELECT player1_id,player2_id,state_json FROM combat_matches
    WHERE status='finished' AND (player1_id=? OR player2_id=?)`).all(user.id,user.id) as Array<{player1_id:number;player2_id:number|null;state_json:string|null}>;
  const matchRecord={played:finishedMatches.length,wins:finishedMatches.reduce((total,match)=>{
    try{
      const winner=(JSON.parse(match.state_json??'null') as {winner?:string|null}|null)?.winner;
      return total+(winner===(match.player1_id===user.id?'p1':'p2')?1:0);
    }catch{return total}
  },0)};
  const decks=db.prepare('SELECT id,name,cards_json,updated_at FROM combat_decks WHERE user_id=? ORDER BY updated_at DESC,name COLLATE NOCASE').all(user.id) as Array<{id:string;name:string;cards_json:string;updated_at:number}>;
  return NextResponse.json({cards,players,matches,matchRecord,decks:decks.map(deck=>({id:deck.id,name:deck.name,cards:JSON.parse(deck.cards_json),updatedAt:deck.updated_at}))},{headers:{'Cache-Control':'no-store'}});
}

export async function POST(request:Request) {
  const user=await currentUser();
  if(!user)return NextResponse.json({error:'Connecte-toi pour lancer un combat.'},{status:401});
  const parsed=createSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:'Deck ou mode de combat invalide.'},{status:400});
  const input=parsed.data;
  if(input.mode==='pvp')return NextResponse.json({error:'Le combat entre joueurs est temporairement inaccessible.'},{status:503});
  const id=randomUUID();
  const now=Date.now();
  try{
    db.exec('BEGIN IMMEDIATE');
    try{
      const deck=ownedDeck(user.id,input.cards);
      if(input.mode==='ai'){
        const botDeck=computerDeck(deck);
        const state=createCombatState({mode:'ai',player1:{id:user.id,username:user.username},player2:{id:null,username:'Daemon du campus'},deck1:deck,deck2:botDeck,randomIndex:randomInt});
        db.prepare(`INSERT INTO combat_matches(id,mode,status,player1_id,player2_id,player1_deck,player2_deck,state_json,created_at,updated_at)
          VALUES(?,'ai','active',?,NULL,?,?,?,?,?)`).run(id,user.id,JSON.stringify(deck),JSON.stringify(botDeck),JSON.stringify(state),now,now);
      }else{
        if(!input.opponentId||input.opponentId===user.id)throw new CombatRuleError('Choisis un autre joueur à défier.');
        const target=db.prepare("SELECT id FROM users WHERE id=? AND role='player'").get(input.opponentId);
        if(!target)throw new CombatRuleError('Ce joueur est introuvable.');
        db.prepare(`INSERT INTO combat_matches(id,mode,status,player1_id,player2_id,player1_deck,created_at,updated_at)
          VALUES(?,'pvp','waiting',?,?,?, ?,?)`).run(id,user.id,input.opponentId,JSON.stringify(deck),now,now);
      }
      // Keep only the three most recently updated matches that can be resumed.
      // Run inside the same write transaction so simultaneous launches cannot exceed the cap.
      pruneResumableCombatMatches(db,user.id);
      db.exec('COMMIT');
    }catch(error){try{db.exec('ROLLBACK')}catch{}throw error}
    return NextResponse.json({ok:true,id,status:input.mode==='ai'?'active':'waiting'},{status:201});
  }catch(error){
    if(error instanceof CombatRuleError)return NextResponse.json({error:error.message},{status:400});
    console.error(error);
    return NextResponse.json({error:'Impossible de créer le combat.'},{status:500});
  }
}
