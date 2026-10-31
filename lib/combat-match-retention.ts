import type { DatabaseSync } from 'node:sqlite';

/** Keep only the three newest active matches a player can resume. Call inside a write transaction. */
export function pruneResumableCombatMatches(database: Pick<DatabaseSync, 'prepare'>, userId: number) {
  return database.prepare(`DELETE FROM combat_matches WHERE id IN (
    SELECT id FROM combat_matches WHERE (player1_id=? OR player2_id=?) AND status='active'
    ORDER BY updated_at DESC,created_at DESC,id DESC LIMIT -1 OFFSET 3
  )`).run(userId, userId);
}
