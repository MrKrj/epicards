import type { DatabaseSync } from 'node:sqlite';
import { COMBAT_ROLES, combatProfileKey, deriveCombatProfile, migrateCombatRoleId, type CombatProfile } from './combat-profiles';

type LegacyCombatProfileRow = {
  card_id: string;
  role_id: string;
  power: number;
  stability: number;
  expertise: number;
  created_at: number;
};

/**
 * Upgrade the catalog combat profile constraint in-place. Only role IDs are
 * remapped where possible; card rows, stat values, and creation timestamps
 * are retained. This is safe to run on every app start and never resets data.
 */
export function migrateCombatProfileRoles(database: DatabaseSync) {
  const schema = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='card_combat_profiles'").get() as { sql: string | null } | undefined;
  if (!schema?.sql || !schema.sql.includes("'devops'")) return { migrated: 0 };

  const rows = database.prepare('SELECT card_id,role_id,power,stability,expertise,created_at FROM card_combat_profiles ORDER BY card_id').all() as LegacyCombatProfileRow[];
  const rolesSql = COMBAT_ROLES.map(role => `'${role.id}'`).join(',');
  const used = new Set<string>();
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('ALTER TABLE card_combat_profiles RENAME TO card_combat_profiles_legacy_v1');
    database.exec(`CREATE TABLE card_combat_profiles (
      card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL CHECK(role_id IN (${rolesSql})),
      power INTEGER NOT NULL CHECK(power BETWEEN 1 AND 10),
      stability INTEGER NOT NULL CHECK(stability BETWEEN 1 AND 10),
      expertise INTEGER NOT NULL CHECK(expertise BETWEEN 1 AND 10),
      created_at INTEGER NOT NULL,
      UNIQUE(role_id,power,stability,expertise)
    )`);

    const insert = database.prepare('INSERT INTO card_combat_profiles(card_id,role_id,power,stability,expertise,created_at) VALUES(?,?,?,?,?,?)');
    for (const row of rows) {
      const preferred = migrateCombatRoleId(row.role_id, row.card_id);
      const preferredIndex = COMBAT_ROLES.findIndex(role => role.id === preferred);
      let profile: CombatProfile | null = null;
      for (let offset = 0; offset < COMBAT_ROLES.length; offset += 1) {
        const candidate: CombatProfile = {
          role: COMBAT_ROLES[(preferredIndex + offset) % COMBAT_ROLES.length].id,
          power: row.power,
          stability: row.stability,
          expertise: row.expertise,
        };
        if (!used.has(combatProfileKey(candidate))) {
          profile = candidate;
          break;
        }
      }
      if (!profile) {
        for (let salt = 0; salt < 20_000; salt += 1) {
          const candidate = deriveCombatProfile(row.card_id, salt);
          if (!used.has(combatProfileKey(candidate))) {
            profile = candidate;
            break;
          }
        }
      }
      if (!profile) throw new Error(`Impossible de migrer le profil de combat de la carte ${row.card_id}.`);
      insert.run(row.card_id, profile.role, profile.power, profile.stability, profile.expertise, row.created_at);
      used.add(combatProfileKey(profile));
    }

    database.exec('DROP TABLE card_combat_profiles_legacy_v1');
    database.exec('COMMIT');
    return { migrated: rows.length };
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch {}
    throw error;
  }
}
