import { z } from 'zod';
import { db } from '@/lib/local-db';
import { CombatRuleError, validateCombatDeck, type CombatCard } from '@/lib/combat-engine';
import { getCombatProfile, type CombatRoleId } from '@/lib/combat-profiles';

export const combatDeckInputSchema=z.object({
  name:z.string().trim().min(2,'Le nom du deck doit contenir au moins 2 caractères.').max(32,'Le nom du deck ne peut pas dépasser 32 caractères.'),
  cards:z.array(z.object({cardId:z.string().min(1).max(100),isShiny:z.boolean()}).strict()).min(8).max(12),
}).strict();

export type CombatDeckReference={cardId:string;isShiny:boolean};
export type CombatDeckInput=z.infer<typeof combatDeckInputSchema>;

type DeckCardRow={id:string;name:string;rarity:string;category:string;set_id:string;set_name:string;image_url:string|null;is_shiny:number;role_id:CombatRoleId|null;power:number|null;stability:number|null;expertise:number|null};

export function validateOwnedCombatDeck(userId:number,refs:CombatDeckReference[]):CombatCard[]{
  const get=db.prepare(`SELECT c.id,c.name,c.rarity,c.category,c.set_id,s.name AS set_name,c.image_url,ci.is_shiny,
      cp.role_id,cp.power,cp.stability,cp.expertise
    FROM card_instances ci JOIN cards c ON c.id=ci.card_id JOIN card_sets s ON s.id=c.set_id
    LEFT JOIN card_combat_profiles cp ON cp.card_id=c.id
    WHERE ci.owner_id=? AND ci.card_id=? AND ci.is_shiny=? AND ci.recycled_at IS NULL AND c.is_active=1 LIMIT 1`);
  const cards=refs.map(ref=>{
    const row=get.get(userId,ref.cardId,Number(ref.isShiny)) as DeckCardRow|undefined;
    if(!row)throw new CombatRuleError('Une carte du deck n’est plus dans ta collection. Modifie ton deck puis réessaie.');
    const combatProfile=row.role_id&&row.power!==null&&row.stability!==null&&row.expertise!==null
      ?{role:row.role_id,power:row.power,stability:row.stability,expertise:row.expertise}:undefined;
    return{id:row.id,name:row.name,rarity:row.rarity,category:row.category,setId:row.set_id,setName:row.set_name,imageUrl:row.image_url,isShiny:Boolean(row.is_shiny),combatProfile:getCombatProfile({id:row.id,combatProfile})};
  });
  const issue=validateCombatDeck(cards);
  if(issue)throw new CombatRuleError(issue);
  return cards;
}
