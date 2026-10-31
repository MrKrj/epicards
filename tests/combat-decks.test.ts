import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/local-db';
import { CombatRuleError } from '../lib/combat-engine';
import { validateOwnedCombatDeck, type CombatDeckReference } from '../lib/combat-decks';

const fixtureId=`test_decks_${randomUUID().replaceAll('-','')}`;
const setId=`${fixtureId}_set`;
const username=fixtureId.slice(0,24);
let userId:number|undefined;
const refs:CombatDeckReference[]=[];

describe('decks de combat enregistrés',()=>{
  afterAll(()=>{
    if(userId)db.prepare('DELETE FROM card_instances WHERE owner_id=?').run(userId);
    for(const ref of refs)db.prepare('DELETE FROM cards WHERE id=?').run(ref.cardId);
    db.prepare('DELETE FROM card_sets WHERE id=?').run(setId);
    if(userId)db.prepare('DELETE FROM users WHERE id=?').run(userId);
  });

  it('valide la possession et les limites de rareté du deck',()=>{
    const user=db.prepare('INSERT INTO users(username,email,password_hash,role,points,created_at) VALUES(?,?,?,\'player\',500,?)').run(username,`${fixtureId}@epitech.eu`,'test-hash',Date.now());
    const uid=Number(user.lastInsertRowid);userId=uid;
    db.prepare('INSERT INTO card_sets(id,name,description,is_default,is_active,color) VALUES(?,?,\'test fixtures\',0,1,\'#3355aa\')').run(setId,fixtureId);
    const rarities=['Commune','Commune','Commune','Commune','Peu commune','Peu commune','Rare','Épique'];
    rarities.forEach((rarity,index)=>{
      const cardId=`${fixtureId}_${index}`;refs.push({cardId,isShiny:false});
      db.prepare('INSERT INTO cards(id,name,description,category,rarity,collection_value,set_id,is_active) VALUES(?,?,\'test\',\'test\',?,0,?,1)').run(cardId,`Carte ${index}`,rarity,setId);
      db.prepare('INSERT INTO card_instances(id,card_id,owner_id,obtained_at,source,is_shiny) VALUES(?,?,?, ?,\'admin\',0)').run(`${cardId}_instance`,cardId,uid,Date.now());
    });

    expect(validateOwnedCombatDeck(uid,refs)).toHaveLength(8);
    expect(()=>validateOwnedCombatDeck(uid,refs.slice(0,7))).toThrow(CombatRuleError);
    const overLimit=[...refs.slice(0,6),{cardId:`${fixtureId}_6`,isShiny:false},{cardId:`${fixtureId}_6`,isShiny:false}];
    expect(()=>validateOwnedCombatDeck(uid,overLimit)).toThrow(CombatRuleError);
    expect(()=>validateOwnedCombatDeck(uid+1,refs)).toThrow('Une carte du deck n’est plus dans ta collection');
  });
});
