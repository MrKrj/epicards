import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/local-db';
import { currentUser } from '../lib/local-auth';
import { GET as getCards } from '../app/api/cards/route';

vi.mock('../lib/local-auth', () => ({ currentUser: vi.fn() }));

const suffix = randomUUID();
const userId = db.prepare(`INSERT INTO users(username,email,password_hash,role,points,created_at)
  VALUES(?,?,?,'player',0,?)`).run(`catalogue_${suffix.slice(0,8)}`, `${suffix}@epitech.eu`, 'test-hash', Date.now()).lastInsertRowid as number;
const setId = `catalogue-test-${suffix}`;
const completeSetId = `catalogue-complete-test-${suffix}`;
const cards = {
  discovered: `catalogue-discovered-${suffix}`,
  shinyOnly: `catalogue-shiny-only-${suffix}`,
  secret: `catalogue-secret-${suffix}`,
  unknown: `catalogue-unknown-${suffix}`,
  complete: `catalogue-complete-${suffix}`,
};

beforeAll(() => {
  const insertSet = db.prepare('INSERT INTO card_sets(id,name,description,is_default,is_active,color) VALUES(?,?,?,0,1,?)');
  insertSet
    .run(setId, `Test catalogue ${suffix}`, '', '#123456');
  insertSet.run(completeSetId, `Série complète ${suffix}`, '', '#654321');
  const insertCard = db.prepare(`INSERT INTO cards(id,name,description,category,rarity,collection_value,set_id,is_active)
    VALUES(?,?,?,?,?,10,?,1)`);
  insertCard.run(cards.discovered, 'Carte découverte test', '', 'Test', 'Rare', setId);
  insertCard.run(cards.shinyOnly, 'Shiny seule test', '', 'Test', 'Rare', setId);
  insertCard.run(cards.secret, 'Carte secrète test', '', 'Test', 'Secrète', setId);
  insertCard.run(cards.unknown, 'Carte inconnue test', '', 'Test', 'Commune', setId);
  insertCard.run(cards.complete, 'Carte complète test', '', 'Test', 'Rare', completeSetId);
  const insertInstance = db.prepare(`INSERT INTO card_instances(id,card_id,owner_id,obtained_at,source,is_shiny,recycled_at)
    VALUES(?,?,?,?,'admin',?,?)`);
  // A recycled regular copy still proves that the community discovered the card.
  insertInstance.run(`instance-discovered-${suffix}`, cards.discovered, userId, Date.now(), 0, Date.now());
  insertInstance.run(`instance-shiny-${suffix}`, cards.shinyOnly, userId, Date.now(), 1, null);
  insertInstance.run(`instance-secret-${suffix}`, cards.secret, userId, Date.now(), 0, null);
  insertInstance.run(`instance-complete-${suffix}`, cards.complete, userId, Date.now(), 0, null);
});

afterAll(() => {
  db.prepare('DELETE FROM card_instances WHERE card_id IN (?,?,?,?,?)').run(...Object.values(cards));
  db.prepare('DELETE FROM cards WHERE set_id IN (?,?)').run(setId, completeSetId);
  db.prepare('DELETE FROM card_sets WHERE id IN (?,?)').run(setId, completeSetId);
  db.prepare('DELETE FROM users WHERE id=?').run(userId);
});

describe('catalogue à découverte communautaire', () => {
  it('montre seulement les cartes non secrètes obtenues en version normale', async () => {
    vi.mocked(currentUser).mockResolvedValue({ id: userId, username: 'catalogue-test', role: 'player', points: 0, created_at: Date.now() });
    const response = await getCards(new Request('http://localhost/api/cards?view=catalogue'));
    expect(response.status).toBe(200);
    const { cards: catalogue } = await response.json() as { cards: Array<{ id: string }> };
    const visibleIds = catalogue.map((card) => card.id);

    expect(visibleIds).toContain(cards.discovered);
    expect(visibleIds).not.toContain(cards.shinyOnly);
    expect(visibleIds).not.toContain(cards.secret);
    expect(visibleIds).not.toContain(cards.unknown);
  });

  it('ne transmet pas les cartes inconnues aux joueurs, mais les montre toutes aux admins', async () => {
    vi.mocked(currentUser).mockResolvedValue({ id: userId, username: 'catalogue-test', role: 'player', points: 0, created_at: Date.now() });
    const playerResponse = await getCards(new Request('http://localhost/api/cards'));
    const playerCards = await playerResponse.json() as { cards: Array<{ id: string }> };
    expect(playerCards.cards.map((card) => card.id)).not.toContain(cards.unknown);

    vi.mocked(currentUser).mockResolvedValue({ id: userId, username: 'admin-test', role: 'admin', points: 0, created_at: Date.now() });
    const adminResponse = await getCards(new Request('http://localhost/api/cards?view=catalogue'));
    const adminCards = await adminResponse.json() as { cards: Array<{ id: string }> };
    const adminIds = adminCards.cards.map((card) => card.id);
    expect(adminIds).toContain(cards.unknown);
    expect(adminIds).toContain(cards.shinyOnly);
    expect(adminIds).toContain(cards.secret);
  });

  it('affiche une découverte restante uniquement si des cartes correspondent aux filtres', async () => {
    vi.mocked(currentUser).mockResolvedValue({ id: userId, username: 'catalogue-test', role: 'player', points: 0, created_at: Date.now() });
    const discovery = (params = '') => getCards(new Request(`http://localhost/api/cards?view=discovery${params}`));

    const allSeriesResponse = await discovery();
    expect((await allSeriesResponse.json()).hasUndiscoveredCards).toBe(true);

    const completeSeriesResponse = await discovery(`&set_id=${encodeURIComponent(completeSetId)}`);
    expect((await completeSeriesResponse.json()).hasUndiscoveredCards).toBe(false);

    const noMatchingSearchResponse = await discovery('&q=aucune-correspondance');
    expect((await noMatchingSearchResponse.json()).hasUndiscoveredCards).toBe(false);
  });
});
