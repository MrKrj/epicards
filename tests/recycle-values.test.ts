import { describe, expect, it } from 'vitest';
import { getRecycleValue, RECYCLE_VALUES } from '../lib/recycle-values';

describe('valeur de recyclage des cartes', () => {
  it('applique les nouvelles valeurs de base des cartes non shiny', () => {
    expect(getRecycleValue('Commune')).toBe(3);
    expect(getRecycleValue('Peu commune')).toBe(7);
    expect(getRecycleValue('Rare')).toBe(20);
    expect(getRecycleValue('Épique')).toBe(75);
    expect(getRecycleValue('Légendaire')).toBe(150);
    expect(getRecycleValue('Secrète')).toBe(400);
  });

  it('ajoute 100 fragments puis dix fois la valeur de rareté pour une shiny', () => {
    for (const [rarity, baseValue] of Object.entries(RECYCLE_VALUES)) {
      expect(getRecycleValue(rarity, true)).toBe(100 + 10 * baseValue);
    }
  });

  it('applique les exemples Commune et Secrète', () => {
    expect(getRecycleValue('Commune', true)).toBe(130);
    expect(getRecycleValue('Secrète', true)).toBe(4100);
  });
});
