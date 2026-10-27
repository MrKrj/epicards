import { describe, expect, it } from 'vitest';
const weights = { Commune: 60, 'Peu commune': 30, Rare: 7, Épique: 2.5, Légendaire: 0.4, Secrète: 0.1 };
describe('configuration de drop initiale', () => {
  it('totalise exactement 100 %', () => expect(Object.values(weights).reduce((a,b)=>a+b,0)).toBe(100));
  it('contient six raretés et aucune probabilité négative', () => { expect(Object.keys(weights)).toHaveLength(6); expect(Object.values(weights).every(v=>v>=0)).toBe(true); });
});
