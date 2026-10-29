import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/local-db';
import { currentUser } from '../lib/local-auth';
import { GET as getRanking } from '../app/api/ranking/route';

vi.mock('../lib/local-auth', () => ({ currentUser: vi.fn() }));

const suffix = randomUUID();
const userId = db.prepare(`INSERT INTO users(username,email,password_hash,role,points,created_at)
  VALUES(?,?,?,'player',0,?)`).run(`ranking_${suffix.slice(0,8)}`, `${suffix}@epitech.eu`, 'test-hash', Date.now()).lastInsertRowid as number;
const setId = `ranking-test-${suffix}`;
const rarities = ['Commune','Peu commune','Rare','Épique','Légendaire','Secrète'];
const cardIds = rarities.map((_,index)=>`ranking-card-${index}-${suffix}`);

beforeAll(() => {
  db.prepare('INSERT INTO card_sets(id,name,description,is_default,is_active,color) VALUES(?,?,?,0,1,?)')
    .run(setId, `Série classement ${suffix}`, '', '#123456');
  const insertCard = db.prepare(`INSERT INTO cards(id,name,description,category,rarity,collection_value,set_id,is_active)
    VALUES(?,?,?,'Test',?,10,?,1)`);
  const insertInstance = db.prepare(`INSERT INTO card_instances(id,card_id,owner_id,obtained_at,source,is_shiny)
    VALUES(?,?,?,?,'admin',?)`);
  rarities.forEach((rarity,index)=>{
    insertCard.run(cardIds[index], `Carte ${rarity}`, '', rarity, setId);
    insertInstance.run(`ranking-normal-${index}-${suffix}`, cardIds[index], userId, Date.now(), 0);
  });
  // Two shiny copies of the same template count as one distinct shiny card.
  insertInstance.run(`ranking-shiny-a-${suffix}`, cardIds[0], userId, Date.now(), 1);
  insertInstance.run(`ranking-shiny-b-${suffix}`, cardIds[0], userId, Date.now(), 1);
});

afterAll(() => {
  db.prepare('DELETE FROM card_instances WHERE owner_id=?').run(userId);
  db.prepare('DELETE FROM cards WHERE set_id=?').run(setId);
  db.prepare('DELETE FROM card_sets WHERE id=?').run(setId);
  db.prepare('DELETE FROM users WHERE id=?').run(userId);
});

describe('répartition de rareté du classement', () => {
  it('compte les types de cartes shiny distincts sans modifier les compteurs de rareté', async () => {
    vi.mocked(currentUser).mockResolvedValue({ id: userId, username: 'ranking-test', role: 'player', points: 0, created_at: Date.now() });
    const response = await getRanking();
    expect(response.status).toBe(200);
    const { players } = await response.json() as { players: Array<Record<string, number | string>> };
    const player = players.find(item=>item.id===userId);
    expect(player).toBeDefined();
    expect(player).toMatchObject({
      common_cards: 1,
      uncommon_cards: 1,
      rare_cards: 1,
      epic_cards: 1,
      legendary_cards: 1,
      secret_cards: 1,
      shiny_cards: 1,
      distinct_cards: 6,
    });
  });
});
