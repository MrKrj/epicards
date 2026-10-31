import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createPasswordHash, db, DROP_WEIGHTS, PACK_WINDOW_MS, verifyPassword } from '../lib/local-db';
import { openBooster } from '../lib/local-drop';
import { POST as signup } from '../app/api/auth/signup/route';
import { POST as signin } from '../app/api/auth/signin/route';

const username=`test_${randomUUID().slice(0,12)}`;
const fixtureSuffix=randomUUID().slice(0,12),fixtureSetId=`test-set-${fixtureSuffix}`,fixtureCardIds=Array.from({length:5},(_,index)=>`test-card-${fixtureSuffix}-${index}`);
let testUserId:number|undefined,defaultSetId:string;
describe('application locale SQLite',()=>{
 beforeAll(()=>{
  const defaultSet=db.prepare('SELECT id FROM card_sets WHERE is_default=1').get() as {id:string}|undefined;
  if(!defaultSet)throw new Error('La collection par défaut doit exister pour tester les boosters.');
  defaultSetId=defaultSet.id;
  db.prepare('INSERT INTO card_sets(id,name,description,color,is_default) VALUES(?,?,?,?,0)').run(fixtureSetId,`Collection de test ${fixtureSuffix}`,'Collection temporaire des tests.','#013afb');
  const insertCard=db.prepare('INSERT INTO cards(id,name,description,category,rarity,collection_value,set_id) VALUES(?,?,?,?,?,?,?)');
  fixtureCardIds.forEach((id,index)=>insertCard.run(id,`Carte de test ${index+1}`,'Carte temporaire pour les tests.','Test','Commune',1,index<3?defaultSetId:fixtureSetId));
 });
 afterAll(()=>{if(testUserId){db.prepare('DELETE FROM drop_history WHERE user_id=?').run(testUserId);db.prepare('DELETE FROM card_instances WHERE owner_id=?').run(testUserId);db.prepare('DELETE FROM booster_openings WHERE user_id=?').run(testUserId);db.prepare('DELETE FROM wallet_transactions WHERE user_id=?').run(testUserId);db.prepare('DELETE FROM marketplace_listings WHERE seller_id=? OR buyer_id=?').run(testUserId,testUserId);db.prepare('DELETE FROM users WHERE id=?').run(testUserId);}for(const id of fixtureCardIds)db.prepare('DELETE FROM cards WHERE id=?').run(id);db.prepare('DELETE FROM card_sets WHERE id=?').run(fixtureSetId);});
 it('conserve la collection par défaut et prépare des cartes temporaires pour ses tests',()=>{
  expect((db.prepare('SELECT is_default FROM card_sets WHERE id=?').get(defaultSetId) as {is_default:number}).is_default).toBe(1);
  expect((db.prepare('SELECT COUNT(*) AS count FROM cards WHERE id IN (?,?,?, ?,?)').get(...fixtureCardIds) as {count:number}).count).toBe(5);
 });
 it('conserve les probabilités de drop à 100 %',()=>{expect(DROP_WEIGHTS.reduce((sum,[,weight])=>sum+weight,0)).toBe(100)});
 it('vérifie le mot de passe haché sans conserver le clair',()=>{const hash=createPasswordHash('mot-de-passe-test');expect(hash).not.toContain('mot-de-passe-test');expect(verifyPassword('mot-de-passe-test',hash)).toBe(true);expect(verifyPassword('incorrect',hash)).toBe(false)});
 it('refuse les inscriptions qui ne sont pas en epitech.eu',async()=>{
  const response=await signup(new Request('http://localhost/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,email:`${username}@example.test`,password:'mot-de-passe-test'})}));expect(response.status).toBe(400);
 });
 it('crée un compte local avec une adresse Epitech puis ouvre une session',async()=>{
  const body={username,email:`${username}@epitech.eu`,password:'mot-de-passe-test'};
  const response=await signup(new Request('http://localhost/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));expect(response.status).toBe(200);const payload=await response.json();testUserId=payload.user.id;expect(payload.user.username).toBe(username);expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  const login=await signin(new Request('http://localhost/api/auth/signin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:body.email,password:body.password})}));expect(login.status).toBe(200);expect(login.headers.get('set-cookie')).toContain('HttpOnly');
 });
 it('ouvre dix boosters gratuits de la collection par défaut puis recharge le lot après une heure',()=>{
  const userId=testUserId!;const now=Date.now();let last:ReturnType<typeof openBooster>|undefined;const instanceIds:string[]=[];
  for(let i=0;i<10;i++){last=openBooster(userId,defaultSetId,true,now+i);if(last.ok)instanceIds.push(...last.instanceIds)}
  expect(last?.ok).toBe(true);if(!last?.ok)throw new Error('Les dix boosters auraient dû être autorisés.');expect(last.remainingPacks).toBe(0);expect(last.retryAt).toBe(now+9+PACK_WINDOW_MS);
  expect(new Set(instanceIds).size).toBe(50);expect(openBooster(userId,defaultSetId,true,now+10)).toEqual({ok:false,retryAt:now+9+PACK_WINDOW_MS});
  expect((db.prepare('SELECT COUNT(*) AS count FROM card_instances WHERE owner_id=?').get(userId) as {count:number}).count).toBe(50);
 });
 it('empêche le gratuit hors collection par défaut et facture les collections',()=>{
  const userId=testUserId!,now=Date.now();
  expect(openBooster(userId,fixtureSetId,true,now)).toMatchObject({ok:false,error:'Les boosters gratuits sont réservés à la collection par défaut.'});
  db.prepare('UPDATE users SET points=250 WHERE id=?').run(userId);
  const purchase=openBooster(userId,fixtureSetId,false,now);expect(purchase.ok).toBe(true);if(!purchase.ok)throw new Error('L’achat aurait dû passer.');
  expect(purchase.cost).toBe(150);expect(purchase.balance).toBe(100);expect(purchase.cards.every(card=>card.set_id===fixtureSetId)).toBe(true);
  expect((db.prepare('SELECT amount,balance_after FROM wallet_transactions WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId) as {amount:number;balance_after:number})).toEqual({amount:-150,balance_after:100});
 });
});
