import { randomInt, randomUUID } from 'node:crypto';
import { db, PACK_LIMIT, PACK_WINDOW_MS, pickRarity } from './local-db';

type CardRow={id:string;name:string;description:string;rarity:string;category:string;collection_value:number;set_id:string;image_url:string|null};
type CollectionRow={id:string;name:string;is_default:number};
export type BoosterResult =
 | {ok:true;boosterId:string;cards:CardRow[];instanceIds:string[];remainingPacks:number;retryAt:number|null;cost:number;balance:number}
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
  const recent=free?db.prepare('SELECT opened_at FROM booster_openings WHERE user_id=? AND is_free=1 AND opened_at>? ORDER BY opened_at ASC').all(userId,now-PACK_WINDOW_MS) as Array<{opened_at:number}>:[];
  if(free&&recent.length>=PACK_LIMIT){db.exec('ROLLBACK');return {ok:false,retryAt:recent[0].opened_at+PACK_WINDOW_MS};}
  const cost=free?0:collection.is_default===1?100:150;
  const user=db.prepare('SELECT points FROM users WHERE id=?').get(userId) as {points:number}|undefined;
  if(!user){db.exec('ROLLBACK');return {ok:false,retryAt:0,error:'Compte introuvable.'};}
  if(user.points<cost){db.exec('ROLLBACK');return {ok:false,retryAt:0,error:`Il faut ${cost} fragments pour ce booster.`};}
  const newBalance=user.points-cost;
  if(cost>0){db.prepare('UPDATE users SET points=? WHERE id=? AND points>=?').run(newBalance,userId,cost);db.prepare('INSERT INTO wallet_transactions(user_id,amount,balance_after,reason,created_at) VALUES(?,?,?, ?,?)').run(userId,-cost, newBalance,`Achat booster · ${collection.name}`,now);}
  const boosterId=randomUUID();
  db.prepare('INSERT INTO booster_openings(id,user_id,opened_at,set_id,is_free) VALUES(?,?,?,?,?)').run(boosterId,userId,now,collection.id,free?1:0);
  const allCards:CardRow[]=[],instanceIds:string[]=[];
  const addInstance=db.prepare("INSERT INTO card_instances(id,card_id,owner_id,obtained_at,source,booster_id) VALUES(?,?,?,?,'drop',?)");
  const addHistory=db.prepare('INSERT INTO drop_history(user_id,instance_id,created_at) VALUES(?,?,?)');
  for(let i=0;i<5;i++){
   const rarity=pickRarity();
   let pool=db.prepare('SELECT id,name,description,rarity,category,collection_value,set_id,image_url FROM cards WHERE is_active=1 AND set_id=? AND rarity=?').all(collection.id,rarity) as CardRow[];
   if(!pool.length)pool=db.prepare('SELECT id,name,description,rarity,category,collection_value,set_id,image_url FROM cards WHERE is_active=1 AND set_id=?').all(collection.id) as CardRow[];
   if(!pool.length)throw new Error('Cette collection ne contient aucune carte active.');
   const card=pool[randomInt(pool.length)],instanceId=randomUUID();
   addInstance.run(instanceId,card.id,userId,now,boosterId);addHistory.run(userId,instanceId,now);allCards.push(card);instanceIds.push(instanceId);
  }
  db.exec('COMMIT');
  const count=recent.length+(free?1:0);
  return {ok:true,boosterId,cards:allCards,instanceIds,remainingPacks:free?PACK_LIMIT-count:PACK_LIMIT-recent.length,retryAt:free&&count>=PACK_LIMIT?Math.min(...recent.map(row=>row.opened_at),now)+PACK_WINDOW_MS:null,cost,balance:newBalance};
 } catch(error){try{db.exec('ROLLBACK')}catch{};throw error;}
}
