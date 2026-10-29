export const RECYCLE_VALUES: Readonly<Record<string, number>> = {
  Commune: 2,
  'Peu commune': 5,
  Rare: 15,
  Épique: 50,
  Légendaire: 100,
  Secrète: 250,
};

export function getRecycleValue(rarity: string, isShiny = false): number {
  const baseValue = RECYCLE_VALUES[rarity] ?? 0;
  return isShiny ? 100 + 10 * baseValue : baseValue;
}
