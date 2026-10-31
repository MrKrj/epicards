import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { pruneResumableCombatMatches } from '../lib/combat-match-retention';

describe('limite des combats reprenables', () => {
  const database = new DatabaseSync(':memory:');

  database.exec(`CREATE TABLE combat_matches (
    id TEXT PRIMARY KEY,
    player1_id INTEGER NOT NULL,
    player2_id INTEGER,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  afterEach(() => database.exec('DELETE FROM combat_matches'));
  afterAll(() => database.close());

  it('conserve les trois actifs les plus récents pour le joueur et laisse l’historique intact', () => {
    const insert = database.prepare('INSERT INTO combat_matches(id,player1_id,player2_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?)');
    insert.run('old-1', 7, null, 'active', 1, 1);
    insert.run('old-2', 7, null, 'active', 2, 2);
    insert.run('keep-3', 7, null, 'active', 3, 3);
    insert.run('keep-4', 8, 7, 'active', 4, 4);
    insert.run('keep-5', 7, null, 'active', 5, 5);
    insert.run('finished', 7, null, 'finished', 6, 6);
    insert.run('other-player', 9, null, 'active', 7, 7);

    pruneResumableCombatMatches(database, 7);

    const remaining = database.prepare('SELECT id FROM combat_matches ORDER BY id').all() as Array<{ id: string }>;
    expect(remaining.map(match => match.id)).toEqual(['finished', 'keep-3', 'keep-4', 'keep-5', 'other-player']);
  });
});
