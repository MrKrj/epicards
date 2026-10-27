import { randomBytes, randomInt, scryptSync, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import demoCards from '../data/cards.json';

export type LocalUser = { id: number; username: string; role: string; points: number; created_at: number };
export const PACK_LIMIT = 10;
export const PACK_WINDOW_MS = 60 * 60 * 1000;
export const DROP_WEIGHTS: ReadonlyArray<readonly [string, number]> = [['Commune',60],['Peu commune',30],['Rare',7],['Épique',2.5],['Légendaire',0.4],['Secrète',0.1]];

declare global { var cardverseLocalDb: DatabaseSync | undefined; }
function openDatabase() {
  const dir = join(process.cwd(), 'data');
  mkdirSync(dir, { recursive: true });
  const database = new DatabaseSync(join(dir, 'cardverse.sqlite'));
  database.exec('PRAGMA busy_timeout=15000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player','moderator','admin')),
      points INTEGER NOT NULL DEFAULT 0 CHECK(points>=0),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS card_sets (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', is_default INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, color TEXT NOT NULL DEFAULT '#013afb');
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
      rarity TEXT NOT NULL, collection_value INTEGER NOT NULL, set_id TEXT NOT NULL REFERENCES card_sets(id), image_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS cards_catalog_idx ON cards(is_active, rarity, category, name);
    CREATE TABLE IF NOT EXISTS booster_openings (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), opened_at INTEGER NOT NULL,
      set_id TEXT REFERENCES card_sets(id), is_free INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS booster_openings_window_idx ON booster_openings(user_id, opened_at DESC);
    CREATE TABLE IF NOT EXISTS card_instances (
      id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id), owner_id INTEGER NOT NULL REFERENCES users(id),
      obtained_at INTEGER NOT NULL, source TEXT NOT NULL CHECK(source IN ('drop','trade','reward','admin')),
      booster_id TEXT REFERENCES booster_openings(id)
    );
    CREATE INDEX IF NOT EXISTS instances_owner_idx ON card_instances(owner_id, obtained_at DESC);
    CREATE TABLE IF NOT EXISTS drop_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
      instance_id TEXT NOT NULL UNIQUE REFERENCES card_instances(id), created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS drop_history_window_idx ON drop_history(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL, balance_after INTEGER NOT NULL CHECK(balance_after>=0), reason TEXT NOT NULL,
      reference_id TEXT, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS wallet_user_idx ON wallet_transactions(user_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS marketplace_listings (
      id TEXT PRIMARY KEY, instance_id TEXT NOT NULL UNIQUE REFERENCES card_instances(id),
      seller_id INTEGER NOT NULL REFERENCES users(id), buyer_id INTEGER REFERENCES users(id),
      price INTEGER NOT NULL CHECK(price>0), status TEXT NOT NULL DEFAULT 'listed' CHECK(status IN ('listed','sold','cancelled')),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS marketplace_active_idx ON marketplace_listings(status,created_at DESC);
  `);
  // Optional first-admin bootstrap; these secrets remain server-side.
  const adminEmail = process.env.CARDVERSE_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.CARDVERSE_ADMIN_PASSWORD;
  const adminUsername = process.env.CARDVERSE_ADMIN_USERNAME?.trim() || 'pedago-admin';
  if (adminEmail && adminPassword && adminPassword.length >= 12) {
    const existing = database.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE').get(adminEmail) as {id:number}|undefined;
    if (existing) database.prepare("UPDATE users SET role='admin' WHERE id=?").run(existing.id);
    else database.prepare("INSERT INTO users(username,email,password_hash,role,points,created_at) VALUES(?,?,?,'admin',500,?)")
      .run(adminUsername,adminEmail,createPasswordHash(adminPassword),Date.now());
  }
  const instanceColumns = database.prepare('PRAGMA table_info(card_instances)').all() as Array<{name:string}>;
  if (!instanceColumns.some((column) => column.name === 'booster_id')) database.exec('ALTER TABLE card_instances ADD COLUMN booster_id TEXT REFERENCES booster_openings(id)');
  database.exec('CREATE INDEX IF NOT EXISTS instances_booster_idx ON card_instances(booster_id)');
  // Preserve old one-card drops as consumed booster slots after upgrading an existing local database.
  database.exec(`INSERT OR IGNORE INTO booster_openings(id,user_id,opened_at)
    SELECT 'legacy-' || dh.id, dh.user_id, dh.created_at FROM drop_history dh
    JOIN card_instances ci ON ci.id=dh.instance_id WHERE ci.booster_id IS NULL`);
  database.exec(`UPDATE card_instances SET booster_id='legacy-' || (SELECT dh.id FROM drop_history dh WHERE dh.instance_id=card_instances.id)
    WHERE booster_id IS NULL AND EXISTS(SELECT 1 FROM drop_history dh WHERE dh.instance_id=card_instances.id)`);
  const addColumnIfMissing = (table:string,column:string,sql:string) => {
    const columns=database.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>;
    if(!columns.some((item)=>item.name===column))database.exec(sql);
  };
  addColumnIfMissing('card_sets','is_default','ALTER TABLE card_sets ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('card_sets','is_active','ALTER TABLE card_sets ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  const hadSetColor=!!(database.prepare('PRAGMA table_info(card_sets)').all() as Array<{name:string}>).some((column)=>column.name==='color');
  addColumnIfMissing('card_sets','color',"ALTER TABLE card_sets ADD COLUMN color TEXT NOT NULL DEFAULT '#013afb'");
  if(!hadSetColor)database.prepare("UPDATE card_sets SET color='#7144cc' WHERE name='Somnolences'").run();
  addColumnIfMissing('cards','image_url','ALTER TABLE cards ADD COLUMN image_url TEXT');
  addColumnIfMissing('booster_openings','set_id','ALTER TABLE booster_openings ADD COLUMN set_id TEXT REFERENCES card_sets(id)');
  addColumnIfMissing('booster_openings','is_free','ALTER TABLE booster_openings ADD COLUMN is_free INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('card_instances','recycled_at','ALTER TABLE card_instances ADD COLUMN recycled_at INTEGER');
  // Seed demo content only on the first launch of a truly empty database.
  // This keeps an intentional catalogue reset empty across server restarts.
  const hasUsers = (database.prepare('SELECT 1 FROM users LIMIT 1').get() as {1:number}|undefined) !== undefined;
  const hasCards = (database.prepare('SELECT 1 FROM cards LIMIT 1').get() as {1:number}|undefined) !== undefined;
  if (!hasUsers && !hasCards) {
    const sets = [...new Set(demoCards.map((card) => card.set_name))];
    const addSet = database.prepare('INSERT OR IGNORE INTO card_sets(id,name,description,color) VALUES(?,?,?,?)');
    for (const name of sets) addSet.run(`set-${slug(name)}`, name, `Collection ${name} — cartes de démonstration.`, name==='Somnolences'?'#7144cc':'#013afb');
    database.prepare('UPDATE card_sets SET is_default=0');
    database.prepare('UPDATE card_sets SET is_default=1 WHERE id=?').run('set-epitech');
    const addCard = database.prepare(`INSERT OR IGNORE INTO cards
      (id,name,description,category,rarity,collection_value,set_id,image_url) VALUES(?,?,?,?,?,?,?,?)`);
    demoCards.forEach((card, index) => addCard.run(`cv-${String(index + 1).padStart(3,'0')}`, card.name, card.description,
      card.category, card.rarity, card.collection_value, `set-${slug(card.set_name)}`, null));
  }
  return database;
}
function slug(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
export const db = globalThis.cardverseLocalDb ?? (globalThis.cardverseLocalDb = openDatabase());
// Migrate the former rarity label without changing users' existing card copies.
db.prepare("UPDATE cards SET rarity='Secrète' WHERE rarity='Exclusive'").run();
// Additive auction migration. This runs outside openDatabase so the persistent
// SQLite singleton also receives new tables during Next.js development HMR.
db.exec(`
  CREATE TABLE IF NOT EXISTS auction_listings (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL REFERENCES card_instances(id),
    seller_id INTEGER NOT NULL REFERENCES users(id),
    start_price INTEGER NOT NULL CHECK(start_price>0),
    current_bid INTEGER NOT NULL CHECK(current_bid>0),
    highest_bidder_id INTEGER REFERENCES users(id),
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','sold','ended','cancelled')),
    created_at INTEGER NOT NULL,
    closed_at INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS auction_instance_active_idx ON auction_listings(instance_id) WHERE status='active';
  CREATE INDEX IF NOT EXISTS auction_active_end_idx ON auction_listings(status,ends_at);
  CREATE INDEX IF NOT EXISTS auction_seller_idx ON auction_listings(seller_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS auction_bids (
    id TEXT PRIMARY KEY,
    auction_id TEXT NOT NULL REFERENCES auction_listings(id),
    bidder_id INTEGER NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL CHECK(amount>0),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS auction_bids_listing_idx ON auction_bids(auction_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS auction_sales (
    auction_id TEXT PRIMARY KEY REFERENCES auction_listings(id),
    card_id TEXT NOT NULL REFERENCES cards(id),
    seller_id INTEGER NOT NULL REFERENCES users(id),
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    price INTEGER NOT NULL CHECK(price>0),
    sold_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS auction_sales_card_idx ON auction_sales(card_id,sold_at DESC);
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    card_id TEXT REFERENCES cards(id),
    created_at INTEGER NOT NULL,
    read_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id,created_at DESC);
  CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications(user_id,read_at,created_at DESC);
`);
// The dev server keeps this SQLite singleton alive across HMR. Apply the
// latest additive migration to that existing connection too, so routes that
// select the series color cannot fail after a schema update.
const currentCardSetColumns = db.prepare('PRAGMA table_info(card_sets)').all() as Array<{name:string}>;
if (!currentCardSetColumns.some((column) => column.name === 'color')) {
  db.exec("ALTER TABLE card_sets ADD COLUMN color TEXT NOT NULL DEFAULT '#013afb'");
}
db.prepare("UPDATE card_sets SET color='#7144cc' WHERE lower(name) LIKE '%somnolence%' AND color='#013afb'").run();
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function newSession(userId: number) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(hashToken(token), userId, now + 30*24*60*60*1000, now);
  return token;
}
export function createPasswordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;
}
export function verifyPassword(password: string, stored: string) {
  const [salt,hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash,'hex');
  const actual = scryptSync(password,salt,expected.length);
  return expected.length === actual.length && timingSafeEqual(expected,actual);
}
export function pickRarity() {
  const roll = randomInt(10000) / 100;
  let total = 0;
  for (const [rarity,weight] of DROP_WEIGHTS) { total += weight; if (roll < total) return rarity; }
  return 'Secrète';
}
export function userDto(user: LocalUser) {
  return { id:user.id, username:user.username, role:user.role, points:user.points, createdAt:user.created_at };
}
