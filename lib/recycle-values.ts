export const RECYCLE_VALUES: Readonly<Record<string, number>> = {
  Commune: 3,
  'Peu commune': 7,
  Rare: 20,
  Épique: 75,
  Légendaire: 150,
  Secrète: 400,
};

export function getRecycleValue(rarity: string, isShiny = false): number {
  const baseValue = RECYCLE_VALUES[rarity] ?? 0;
  return isShiny ? 100 + 10 * baseValue : baseValue;
}
