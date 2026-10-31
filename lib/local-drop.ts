import { randomInt, randomUUID } from 'node:crypto';
import { db, PACK_LIMIT, PACK_WINDOW_MS, pickRarity } from './local-db';
import { getDropQuota } from './drop-quota';

type CardRow={id:string;name:string;description:string;rarity:string;category:string;collection_value:number;set_id:string;image_url:string|null};
// Calibré pour obtenir 1% de chance qu'un booster de cinq cartes contienne au moins un shiny.
const SHINY_CHANCE_PER_CARD=1-Math.pow(0.99,1/5);
const SHINY_RANDOM_SCALE=1_000_000_000_000;
const SHINY_RANDOM_THRESHOLD=Math.round(SHINY_CHANCE_PER_CARD*SHINY_RANDOM_SCALE);
type CollectionRow={id:string;name:string;is_default:number};
export type BoosterResult =
 | {ok:true;boosterId:string;cards:Array<CardRow&{is_shiny:boolean}>;instanceIds:string[];recyclableDuplicateCount:number;remainingPacks:number;retryAt:number|null;cost:number;balance:number}
 | {ok:false;retryAt:number;error?:string};

/** One atomic free or paid booster operation, including currency debit and five unique card instances. */
export function openBooster(userId:number,setId:string|null=null,free=true,now=Date.now()):BoosterResult {
 db.exec('BEGIN IMMEDIATE');
 try {
  const defaultSet=db.prepare('SELECT id,name,is_default FROM card_sets WHERE is_default=1').get() as CollectionRow|undefined;
  if(!defaultSet)throw new Error('Aucune collection par défaut n’est configurée.');
  const collection=setId?db.prepare('SELECT id,name,is_default FROM card_sets WHERE id=?').get(setId) as CollectionRow|undefined:defaultSet;
  if(!collection){db.exec('ROLLBACK');return {ok:false,retryAt:0,error:'Collection introuvable.'};}
  if(free&&collection.is_default!==1){db.exec('ROLLBACK');return {ok:false,retryAt:0,error:'Les boosters gratuits sont réservés à la collection par défaut.'};}
  const history=free?db.prepare('SELECT opened_at FROM booster_openings WHERE user_id=? AND is_free=1 ORDER BY opened_at DESC LIMIT 11').all(userId) as Array<{opened_at:number}>:[];
  const before=getDropQuota(history.map(row=>row.opened_at),now);
  if(free&&before.available<=0){db.exec('ROLLBACK');return {ok:false,retryAt:before.retryAt??now+PACK_WINDOW_MS};}
  const cost=free?0:collection.is_default===1?100:150;
  const user=db.prepare('SELECT points FROM users WHERE id=?').get(userId) as {points:number}|undefined;
  if(!user){db.exec('ROLLBACK');return {ok:false,retryAt:0,error:'Compte introuvable.'};}
  if(user.points<cost){db.exec('ROLLBACK');return {ok:false,retryAt:0,error:`Il faut ${cost} fragments pour ce booster.`};}
  const newBalance=user.points-cost;
  const eligibleCount=db.prepare('SELECT COUNT(*) AS total FROM cards WHERE is_active=1 AND booster_eligible=1 AND set_id=?').get(collection.id) as {total:number};
  if(!eligibleCount.total){db.exec('ROLLBACK');return {ok:false,retryAt:0,error:'Cette série ne contient aucune carte obtenable en booster.'};}
  if(cost>0){db.prepare('UPDATE users SET points=? WHERE id=? AND points>=?').run(newBalance,userId,cost);db.prepare('INSERT INTO wallet_transactions(user_id,amount,balance_after,reason,created_at) VALUES(?,?,?, ?,?)').run(userId,-cost, newBalance,`Achat booster · ${collection.name}`,now);}
  const boosterId=randomUUID();
  db.prepare('INSERT INTO booster_openings(id,user_id,opened_at,set_id,is_free) VALUES(?,?,?,?,?)').run(boosterId,userId,now,collection.id,free?1:0);
  const allCards:Array<CardRow&{is_shiny:boolean}>=[],instanceIds:string[]=[];
  let recyclableDuplicateCount=0;
  const hasPriorVariant=db.prepare(`SELECT 1 FROM card_instances WHERE owner_id=? AND card_id=? AND is_shiny=?
   AND recycled_at IS NULL AND (booster_id IS NULL OR booster_id<>?) LIMIT 1`);
  const addInstance=db.prepare("INSERT INTO card_instances(id,card_id,owner_id,obtained_at,source,booster_id,is_shiny) VALUES(?,?,?,?,'drop',?,?)");
  const addHistory=db.prepare('INSERT INTO drop_history(user_id,instance_id,created_at) VALUES(?,?,?)');
  for(let i=0;i<5;i++){
   const rarity=pickRarity();
   let pool=db.prepare('SELECT id,name,description,rarity,category,collection_value,set_id,image_url FROM cards WHERE is_active=1 AND booster_eligible=1 AND set_id=? AND rarity=?').all(collection.id,rarity) as CardRow[];
   if(!pool.length)pool=db.prepare('SELECT id,name,description,rarity,category,collection_value,set_id,image_url FROM cards WHERE is_active=1 AND booster_eligible=1 AND set_id=?').all(collection.id) as CardRow[];
   if(!pool.length)throw new Error('Cette collection ne contient aucune carte active.');
   const card=pool[randomInt(pool.length)],instanceId=randomUUID(),isShiny=randomInt(SHINY_RANDOM_SCALE)<SHINY_RANDOM_THRESHOLD;
   if(!isShiny&&(card.rarity==='Commune'||card.rarity==='Peu commune')&&hasPriorVariant.get(userId,card.id,0,boosterId))recyclableDuplicateCount++;
   addInstance.run(instanceId,card.id,userId,now,boosterId,Number(isShiny));addHistory.run(userId,instanceId,now);allCards.push({...card,is_shiny:isShiny});instanceIds.push(instanceId);
  }
  db.exec('COMMIT');
  const after=getDropQuota(free?[...history.map(row=>row.opened_at),now]:history.map(row=>row.opened_at),now);
  return {ok:true,boosterId,cards:allCards,instanceIds,recyclableDuplicateCount,remainingPacks:after.available,retryAt:after.retryAt,cost,balance:newBalance};
 } catch(error){try{db.exec('ROLLBACK')}catch{};throw error;}
}
