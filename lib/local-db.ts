import { randomBytes, randomInt, scryptSync, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import demoCards from '../data/cards.json';
import { COMBAT_ROLES, combatProfileKey, deriveCombatProfile, randomCombatProfile, type CombatProfile } from './combat-profiles';
import { migrateCombatProfileRoles } from './combat-profile-migration';

export type LocalUser = { id: number; username: string; role: string; points: number; created_at: number };
export const PACK_LIMIT = 10;
export const PACK_WINDOW_MS = 60 * 60 * 1000;
export const DROP_WEIGHTS: ReadonlyArray<readonly [string, number]> = [['Commune',60],['Peu commune',30],['Rare',7],['Épique',2.5],['Légendaire',0.4],['Secrète',0.1]];

declare global { var cardverseLocalDb: DatabaseSync | undefined; }
let moduleDatabaseInitialized = false;
function openDatabase() {
  const dir = join(process.cwd(), 'data');
  const databasePath = process.env.CARDVERSE_DB_PATH?.trim() ? resolve(process.env.CARDVERSE_DB_PATH.trim()) : join(dir, 'cardverse.sqlite');
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
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
      booster_eligible INTEGER NOT NULL DEFAULT 1 CHECK(booster_eligible IN (0,1)),
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
      booster_id TEXT REFERENCES booster_openings(id), is_shiny INTEGER NOT NULL DEFAULT 0 CHECK(is_shiny IN (0,1))
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
    CREATE TABLE IF NOT EXISTS cardle_daily (
      puzzle_day TEXT PRIMARY KEY, card_id TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cardle_guesses (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      puzzle_day TEXT NOT NULL, guess_card_id TEXT NOT NULL, guess_order INTEGER NOT NULL,
      created_at INTEGER NOT NULL, PRIMARY KEY(user_id,puzzle_day,guess_order),
      UNIQUE(user_id,puzzle_day,guess_card_id)
    );
    CREATE INDEX IF NOT EXISTS cardle_guesses_daily_idx ON cardle_guesses(puzzle_day,user_id,guess_order);
  CREATE TABLE IF NOT EXISTS cardle_rewards (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    puzzle_day TEXT NOT NULL,
    fragments INTEGER NOT NULL CHECK(fragments>0),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,puzzle_day)
  );
  CREATE TABLE IF NOT EXISTS blurred_card_daily (
    puzzle_day TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    focus_x INTEGER NOT NULL,
    focus_y INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS blurred_card_guesses (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    puzzle_day TEXT NOT NULL,
    guess_card_id TEXT NOT NULL,
    guess_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,puzzle_day,guess_order),
    UNIQUE(user_id,puzzle_day,guess_card_id)
  );
  CREATE INDEX IF NOT EXISTS blurred_card_guesses_daily_idx ON blurred_card_guesses(puzzle_day,user_id,guess_order);
  CREATE TABLE IF NOT EXISTS blurred_card_rewards (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    puzzle_day TEXT NOT NULL,
    fragments INTEGER NOT NULL CHECK(fragments>0),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,puzzle_day)
  );
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
  addColumnIfMissing('cards','booster_eligible','ALTER TABLE cards ADD COLUMN booster_eligible INTEGER NOT NULL DEFAULT 1 CHECK(booster_eligible IN (0,1))');
  addColumnIfMissing('booster_openings','set_id','ALTER TABLE booster_openings ADD COLUMN set_id TEXT REFERENCES card_sets(id)');
  addColumnIfMissing('booster_openings','is_free','ALTER TABLE booster_openings ADD COLUMN is_free INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('card_instances','recycled_at','ALTER TABLE card_instances ADD COLUMN recycled_at INTEGER');
  addColumnIfMissing('card_instances','is_shiny','ALTER TABLE card_instances ADD COLUMN is_shiny INTEGER NOT NULL DEFAULT 0 CHECK(is_shiny IN (0,1))');
  database.exec('CREATE INDEX IF NOT EXISTS instances_discovery_idx ON card_instances(card_id, is_shiny)');
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
function initializeDatabase(database: DatabaseSync) {
  const db = database;
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
// Daily card guessing game. Kept additive so existing SQLite inventories remain intact.
db.exec(`
  CREATE TABLE IF NOT EXISTS cardle_daily (
    puzzle_day TEXT PRIMARY KEY, card_id TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cardle_guesses (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    puzzle_day TEXT NOT NULL, guess_card_id TEXT NOT NULL, guess_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL, PRIMARY KEY(user_id,puzzle_day,guess_order),
    UNIQUE(user_id,puzzle_day,guess_card_id)
  );
  CREATE INDEX IF NOT EXISTS cardle_guesses_daily_idx ON cardle_guesses(puzzle_day,user_id,guess_order);
  CREATE TABLE IF NOT EXISTS cardle_rewards (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    puzzle_day TEXT NOT NULL,
    fragments INTEGER NOT NULL CHECK(fragments>0),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,puzzle_day)
  );
  CREATE TABLE IF NOT EXISTS blurred_card_daily (
    puzzle_day TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    focus_x INTEGER NOT NULL,
    focus_y INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS blurred_card_guesses (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    puzzle_day TEXT NOT NULL,
    guess_card_id TEXT NOT NULL,
    guess_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,puzzle_day,guess_order),
    UNIQUE(user_id,puzzle_day,guess_card_id)
  );
  CREATE INDEX IF NOT EXISTS blurred_card_guesses_daily_idx ON blurred_card_guesses(puzzle_day,user_id,guess_order);
  CREATE TABLE IF NOT EXISTS blurred_card_rewards (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    puzzle_day TEXT NOT NULL,
    fragments INTEGER NOT NULL CHECK(fragments>0),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,puzzle_day)
  );
  CREATE TABLE IF NOT EXISTS described_card_daily (
    puzzle_day TEXT PRIMARY KEY, card_id TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS described_card_guesses (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    puzzle_day TEXT NOT NULL,
    guess_card_id TEXT NOT NULL,
    guess_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,puzzle_day,guess_order),
    UNIQUE(user_id,puzzle_day,guess_card_id)
  );
  CREATE INDEX IF NOT EXISTS described_card_guesses_daily_idx ON described_card_guesses(puzzle_day,user_id,guess_order);
  CREATE TABLE IF NOT EXISTS described_card_rewards (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    puzzle_day TEXT NOT NULL,
    fragments INTEGER NOT NULL CHECK(fragments>0),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,puzzle_day)
  );
`);
// The dev server keeps this SQLite singleton alive across HMR. Apply the
// latest additive migration to that existing connection too, so routes that
// select the series color cannot fail after a schema update.
const currentCardSetColumns = db.prepare('PRAGMA table_info(card_sets)').all() as Array<{name:string}>;
if (!currentCardSetColumns.some((column) => column.name === 'color')) {
  db.exec("ALTER TABLE card_sets ADD COLUMN color TEXT NOT NULL DEFAULT '#013afb'");
}
db.prepare("UPDATE card_sets SET color='#7144cc' WHERE lower(name) LIKE '%somnolence%' AND color='#013afb'").run();
// Campus combat matches are additive; they do not mutate card inventories.
db.exec(`
  CREATE TABLE IF NOT EXISTS combat_matches (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL CHECK(mode IN ('ai','pvp')),
    status TEXT NOT NULL CHECK(status IN ('waiting','active','finished','declined','cancelled')),
    player1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player2_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    player1_deck TEXT NOT NULL,
    player2_deck TEXT,
    state_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS combat_matches_player1_idx ON combat_matches(player1_id,status,updated_at DESC);
  CREATE INDEX IF NOT EXISTS combat_matches_player2_idx ON combat_matches(player2_id,status,updated_at DESC);
  CREATE TABLE IF NOT EXISTS combat_decks (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    cards_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user_id,name)
  );
  CREATE INDEX IF NOT EXISTS combat_decks_user_idx ON combat_decks(user_id,updated_at DESC);
`);

// Additive, catalog-level combat identity. Existing card records receive a
// stable generated profile; new admin-created cards receive a cryptographic
// random profile in createCombatProfileForNewCard().
db.exec(`
  CREATE TABLE IF NOT EXISTS card_combat_profiles (
    card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL CHECK(role_id IN (${COMBAT_ROLES.map(role => `'${role.id}'`).join(',')})),
    power INTEGER NOT NULL CHECK(power BETWEEN 1 AND 10),
    stability INTEGER NOT NULL CHECK(stability BETWEEN 1 AND 10),
    expertise INTEGER NOT NULL CHECK(expertise BETWEEN 1 AND 10),
    created_at INTEGER NOT NULL,
    UNIQUE(role_id,power,stability,expertise)
  );
`);
migrateCombatProfileRoles(db);
  db.exec('BEGIN IMMEDIATE');
try {
  const profileBackfillRows = db.prepare(`SELECT c.id FROM cards c LEFT JOIN card_combat_profiles p ON p.card_id=c.id WHERE p.card_id IS NULL ORDER BY c.id`).all() as Array<{id:string}>;
  const existingProfileRows = db.prepare('SELECT role_id,power,stability,expertise FROM card_combat_profiles').all() as Array<{role_id:CombatProfile['role'];power:number;stability:number;expertise:number}>;
  const existingProfileKeys = new Set(existingProfileRows.map(profile => combatProfileKey({role:profile.role_id,power:profile.power,stability:profile.stability,expertise:profile.expertise})));
  const addBackfilledProfile = db.prepare('INSERT INTO card_combat_profiles(card_id,role_id,power,stability,expertise,created_at) VALUES(?,?,?,?,?,?)');
  for (const card of profileBackfillRows) {
    let salt = 0;
    let profile: CombatProfile;
    do { profile = deriveCombatProfile(card.id,salt++); } while (existingProfileKeys.has(combatProfileKey(profile)));
    addBackfilledProfile.run(card.id,profile.role,profile.power,profile.stability,profile.expertise,Date.now());
    existingProfileKeys.add(combatProfileKey(profile));
  }
  db.exec('COMMIT');
} catch (error) {
  try { db.exec('ROLLBACK'); } catch {}
  throw error;
}
}

function getDatabase() {
  let database = globalThis.cardverseLocalDb;
  const isNewConnection = !database;
  if (!database) {
    database = openDatabase();
  }
  if (!moduleDatabaseInitialized) {
    try {
      initializeDatabase(database);
    } catch (error) {
      if (isNewConnection) database.close();
      throw error;
    }
    moduleDatabaseInitialized = true;
  }
  if (isNewConnection) globalThis.cardverseLocalDb = database;
  return database;
}

export const db = new Proxy({} as DatabaseSync, {
  get(_target, property) {
    const database = getDatabase();
    const value = Reflect.get(database, property, database);
    return typeof value === 'function' ? value.bind(database) : value;
  },
});

export function createCombatProfileForNewCard(cardId: string): CombatProfile {
  const existing = db.prepare('SELECT role_id,power,stability,expertise FROM card_combat_profiles WHERE card_id=?').get(cardId) as {role_id:CombatProfile['role'];power:number;stability:number;expertise:number}|undefined;
  if (existing) return { role:existing.role_id,power:existing.power,stability:existing.stability,expertise:existing.expertise };
  const used = db.prepare('SELECT 1 FROM card_combat_profiles WHERE role_id=? AND power=? AND stability=? AND expertise=?');
  const insert = db.prepare('INSERT INTO card_combat_profiles(card_id,role_id,power,stability,expertise,created_at) VALUES(?,?,?,?,?,?)');
  for (let attempt=0; attempt<20_000; attempt+=1) {
    const profile = randomCombatProfile(randomInt);
    if (used.get(profile.role,profile.power,profile.stability,profile.expertise)) continue;
    insert.run(cardId,profile.role,profile.power,profile.stability,profile.expertise,Date.now());
    return profile;
  }
  throw new Error('Aucun profil de combat libre.');
}
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
