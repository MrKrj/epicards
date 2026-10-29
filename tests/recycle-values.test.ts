import { describe, expect, it } from 'vitest';
import { getRecycleValue, RECYCLE_VALUES } from '../lib/recycle-values';

describe('valeur de recyclage des cartes', () => {
  it('conserve la valeur de base des cartes non shiny', () => {
    expect(getRecycleValue('Commune')).toBe(2);
    expect(getRecycleValue('Peu commune')).toBe(5);
    expect(getRecycleValue('Rare')).toBe(15);
    expect(getRecycleValue('Épique')).toBe(50);
    expect(getRecycleValue('Légendaire')).toBe(100);
    expect(getRecycleValue('Secrète')).toBe(250);
  });

  it('ajoute 100 fragments puis dix fois la valeur de rareté pour une shiny', () => {
    for (const [rarity, baseValue] of Object.entries(RECYCLE_VALUES)) {
      expect(getRecycleValue(rarity, true)).toBe(100 + 10 * baseValue);
    }
  });

  it('applique les exemples Commune et Secrète', () => {
    expect(getRecycleValue('Commune', true)).toBe(120);
    expect(getRecycleValue('Secrète', true)).toBe(2600);
  });
});
