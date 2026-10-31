import { describe, expect, it } from 'vitest';
import { COMBAT_ROLES, combatProfileIsValid, combatProfileKey, combatStatsModifier, deriveCombatProfile, getCombatProfile, randomCombatProfile } from '../lib/combat-profiles';

describe('profils de combat générés automatiquement',()=>{
  it('produit un profil complet avec des caractéristiques bornées et un rôle valide',()=>{
    const values=[3,6,8,2];
    const profile=randomCombatProfile(max=>values.shift()!%max);
    expect(combatProfileIsValid(profile)).toBe(true);
    expect(COMBAT_ROLES.some(role=>role.id===profile.role)).toBe(true);
    expect([profile.power,profile.stability,profile.expertise].every(value=>value>=1&&value<=10)).toBe(true);
  });

  it('expose exactement les six rôles techniques retenus',()=>{
    expect(COMBAT_ROLES.map(role=>role.id)).toEqual(['ci_cd','api','stack','ram','elasticity_cloud','unit_test']);
  });

  it('garde un profil historique déterministe pour une même carte',()=>{
    expect(deriveCombatProfile('card-17')).toEqual(deriveCombatProfile('card-17'));
    expect(getCombatProfile({id:'card-17'})).toEqual(deriveCombatProfile('card-17'));
  });

  it('borne l’influence des caractéristiques à un point de puissance',()=>{
    expect(combatStatsModifier({role:'stack',power:1,stability:1,expertise:1})).toBe(-1);
    expect(combatStatsModifier({role:'stack',power:5,stability:5,expertise:5})).toBe(0);
    expect(combatStatsModifier({role:'stack',power:10,stability:10,expertise:10})).toBe(1);
  });

  it('fournit une clé stable pour détecter les profils en double',()=>{
    const profile={role:'unit_test' as const,power:4,stability:7,expertise:2};
    expect(combatProfileKey(profile)).toBe('unit_test:4:7:2');
  });

  it('reconnaît un ancien profil sauvegardé et le convertit sans perdre ses stats',()=>{
    expect(getCombatProfile({id:'ancienne-carte',combatProfile:{role:'devops' as never,power:7,stability:4,expertise:9}})).toEqual({role:'ci_cd',power:7,stability:4,expertise:9});
  });
});
