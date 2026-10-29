import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/local-db';
import { currentUser } from '../lib/local-auth';
import { GET as getCardle, POST as postCardle } from '../app/api/demo/cardle/route';
import { GET as getBlurred, POST as postBlurred } from '../app/api/demo/blurred-card/route';
import { GET as getDescribed, POST as postDescribed } from '../app/api/demo/described-card/route';

vi.mock('../lib/local-auth', () => ({ currentUser: vi.fn() }));

const suffix = randomUUID();
const playerId = db.prepare(`INSERT INTO users(username,email,password_hash,role,points,created_at)
  VALUES(?,?,?,'player',0,?)`).run(`minigame_player_${suffix.slice(0,8)}`, `${suffix}@epitech.eu`, 'test-hash', Date.now()).lastInsertRowid as number;
const adminId = db.prepare(`INSERT INTO users(username,email,password_hash,role,points,created_at)
  VALUES(?,?,?,'admin',0,?)`).run(`minigame_admin_${suffix.slice(0,8)}`, `admin-${suffix}@epitech.eu`, 'test-hash', Date.now()).lastInsertRowid as number;
const setId = `minigame-test-${suffix}`;
const cards = {
  discovered: `minigame-discovered-${suffix}`,
  shinyOnly: `minigame-shiny-${suffix}`,
  secret: `minigame-secret-${suffix}`,
  unknown: `minigame-unknown-${suffix}`,
  adminOnly: `minigame-admin-${suffix}`,
};
const gameTables = ['cardle', 'blurred_card', 'described_card'] as const;

beforeAll(() => {
  db.prepare('INSERT INTO card_sets(id,name,description,is_default,is_active,color) VALUES(?,?,?,0,1,?)')
    .run(setId, `Test mini-jeux ${suffix}`, '', '#123456');
  const insertCard = db.prepare(`INSERT INTO cards(id,name,description,category,rarity,collection_value,set_id,image_url,is_active)
    VALUES(?,?,?,?,?,10,?,?,1)`);
  insertCard.run(cards.discovered, 'Carte découverte', 'Description de test', 'Test', 'Rare', setId, 'https://example.test/discovered.png');
  insertCard.run(cards.shinyOnly, 'Carte shiny seule', 'Description de test', 'Test', 'Rare', setId, 'https://example.test/shiny.png');
  insertCard.run(cards.secret, 'Carte secrète', 'Description de test', 'Test', 'Secrète', setId, 'https://example.test/secret.png');
  insertCard.run(cards.unknown, 'Carte inconnue', 'Description de test', 'Test', 'Commune', setId, 'https://example.test/unknown.png');
  insertCard.run(cards.adminOnly, 'Carte connue de l’admin seulement', 'Description de test', 'Test', 'Épique', setId, 'https://example.test/admin.png');
  const addInstance = db.prepare(`INSERT INTO card_instances(id,card_id,owner_id,obtained_at,source,is_shiny)
    VALUES(?,?,?,?,'admin',?)`);
  addInstance.run(`instance-normal-${suffix}`, cards.discovered, playerId, Date.now(), 0);
  addInstance.run(`instance-shiny-${suffix}`, cards.shinyOnly, playerId, Date.now(), 1);
  addInstance.run(`instance-secret-${suffix}`, cards.secret, playerId, Date.now(), 0);
  addInstance.run(`instance-admin-${suffix}`, cards.adminOnly, adminId, Date.now(), 0);
});

afterAll(() => {
  for (const table of gameTables) {
    db.prepare(`DELETE FROM ${table}_guesses WHERE guess_card_id IN (?,?,?,?,?)`).run(...Object.values(cards));
    db.prepare(`DELETE FROM ${table}_daily WHERE card_id IN (?,?,?,?,?)`).run(...Object.values(cards));
    db.prepare(`DELETE FROM ${table}_rewards WHERE user_id IN (?,?)`).run(playerId, adminId);
  }
  db.prepare('DELETE FROM wallet_transactions WHERE user_id IN (?,?)').run(playerId, adminId);
  db.prepare('DELETE FROM card_instances WHERE card_id IN (?,?,?,?,?)').run(...Object.values(cards));
  db.prepare('DELETE FROM cards WHERE set_id=?').run(setId);
  db.prepare('DELETE FROM card_sets WHERE id=?').run(setId);
  db.prepare('DELETE FROM users WHERE id IN (?,?)').run(playerId, adminId);
});

const routes = [
  { name: 'Carte mystère', get: getCardle, post: postCardle },
  { name: 'Carte floutée', get: getBlurred, post: postBlurred },
  { name: 'Carte décrite', get: getDescribed, post: postDescribed },
];

describe.each(routes)('$name limité aux découvertes communautaires', ({ get, post }) => {
  it('ne propose que les cartes découvertes, même à un administrateur', async () => {
    vi.mocked(currentUser).mockResolvedValue({ id: adminId, username: 'minigame-admin', role: 'admin', points: 0, created_at: Date.now() });
    const response = await get();
    expect(response.status).toBe(200);
    const { options } = await response.json() as { options: Array<{ id: string }> };
    const optionIds = options.map((option) => option.id);
    expect(optionIds).toContain(cards.discovered);
    expect(optionIds).toContain(cards.shinyOnly);
    expect(optionIds).not.toContain(cards.secret);
    expect(optionIds).not.toContain(cards.unknown);
    expect(optionIds).not.toContain(cards.adminOnly);
  });

  it('refuse côté serveur une carte secrète ou non découverte', async () => {
    vi.mocked(currentUser).mockResolvedValue({ id: playerId, username: 'minigame-player', role: 'player', points: 0, created_at: Date.now() });
    const shinyResponse = await post(new Request('http://localhost/api/demo/minigame', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cardId: cards.shinyOnly }),
    }));
    expect(shinyResponse.status).toBe(200);
    for (const cardId of [cards.secret, cards.unknown, cards.adminOnly]) {
      const response = await post(new Request('http://localhost/api/demo/minigame', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cardId }),
      }));
      expect(response.status, `${cardId} should not be guessable`).toBe(404);
    }
  });
});
