import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrateCombatProfileRoles } from '../lib/combat-profile-migration';
import { COMBAT_ROLES } from '../lib/combat-profiles';

describe('migration des rôles techniques',()=>{
  let database:DatabaseSync|undefined;
  afterEach(()=>{database?.close();database=undefined});

  it('garde les cartes et les statistiques en remplaçant la contrainte des huit anciens rôles',()=>{
    database=new DatabaseSync(':memory:');
    database.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE cards(id TEXT PRIMARY KEY);
      CREATE TABLE card_combat_profiles(
        card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
        role_id TEXT NOT NULL CHECK(role_id IN ('devops','ia','cloud','security','data','network','frontend','backend')),
        power INTEGER NOT NULL CHECK(power BETWEEN 1 AND 10),
        stability INTEGER NOT NULL CHECK(stability BETWEEN 1 AND 10),
        expertise INTEGER NOT NULL CHECK(expertise BETWEEN 1 AND 10),
        created_at INTEGER NOT NULL,
        UNIQUE(role_id,power,stability,expertise)
      );
    `);
    const oldRoles=['devops','ia','cloud','security','data','network','frontend','backend'];
    const insertCard=database.prepare('INSERT INTO cards(id) VALUES(?)');
    const insertProfile=database.prepare('INSERT INTO card_combat_profiles(card_id,role_id,power,stability,expertise,created_at) VALUES(?,?,?,?,?,?)');
    oldRoles.forEach((role,index)=>{
      const id=`card-${index}`;insertCard.run(id);insertProfile.run(id,role,5,6,7,100+index);
    });

    expect(migrateCombatProfileRoles(database)).toEqual({migrated:8});
    const rows=database.prepare('SELECT card_id,role_id,power,stability,expertise,created_at FROM card_combat_profiles ORDER BY card_id').all() as Array<{card_id:string;role_id:string;power:number;stability:number;expertise:number;created_at:number}>;
    expect(rows).toHaveLength(8);
    expect(rows.every(row=>COMBAT_ROLES.some(role=>role.id===row.role_id))).toBe(true);
    expect(new Set(rows.map(row=>`${row.role_id}:${row.power}:${row.stability}:${row.expertise}`)).size).toBe(8);
    expect(rows[0]).toMatchObject({card_id:'card-0',power:5,stability:6,expertise:7,created_at:100});
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='card_combat_profiles_legacy_v1'").get()).toBeUndefined();
    expect(migrateCombatProfileRoles(database)).toEqual({migrated:0});
  });
});
