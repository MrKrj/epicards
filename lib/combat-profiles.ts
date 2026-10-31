export const COMBAT_ROLES = [
  { id: 'ci_cd', name: 'CI/CD', shortName: 'CI/CD', module: 'CI/CD', description: 'À son arrivée, donne +1 puissance à chaque carte alliée déjà présente sur ce canal.' },
  { id: 'api', name: 'API', shortName: 'API', module: 'API', description: 'Gagne +2 puissance.' },
  { id: 'stack', name: 'Stack', shortName: 'Stack', module: 'Stack', description: 'Gagne +1 puissance toutes les deux cartes jouées après elle, jusqu’à +3 par manche.' },
  { id: 'ram', name: 'RAM', shortName: 'RAM', module: 'RAM', description: 'Si elle survit, revient à la manche suivante avec la moitié de sa puissance finale, puis disparaît.' },
  { id: 'elasticity_cloud', name: 'Elasticity Cloud', shortName: 'Cloud', module: 'Elasticity Cloud', description: 'Donne +1 puissance à la carte alliée la plus puissante d’un autre canal.' },
  { id: 'unit_test', name: 'Unit Test', shortName: 'Unit Test', module: 'Unit Test', description: 'Réduit de 2 la puissance de la carte adverse la plus puissante sur ce canal.' },
] as const;

export type CombatRoleId = typeof COMBAT_ROLES[number]['id'];
export type CombatProfile = { role: CombatRoleId; power: number; stability: number; expertise: number };
export type CombatProfiled = { id: string; combatProfile?: CombatProfile | null };

const roleIds = new Set<string>(COMBAT_ROLES.map(role => role.id));
const isStat = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 10;

export function combatProfileIsValid(profile: unknown): profile is CombatProfile {
  if (!profile || typeof profile !== 'object') return false;
  const value = profile as Partial<CombatProfile>;
  return typeof value.role === 'string' && roleIds.has(value.role) && isStat(value.power) && isStat(value.stability) && isStat(value.expertise);
}

const legacyRoleMap: Readonly<Record<string, CombatRoleId>> = {
  devops: 'ci_cd',
  backend: 'api',
  frontend: 'api',
  ia: 'stack',
  network: 'ram',
  cloud: 'elasticity_cloud',
  data: 'unit_test',
  security: 'unit_test',
};

export function migrateCombatRoleId(role: string, seed = ''): CombatRoleId {
  if (roleIds.has(role)) return role as CombatRoleId;
  return legacyRoleMap[role] ?? COMBAT_ROLES[hash32(`${seed}\u0000legacy-role`) % COMBAT_ROLES.length].id;
}

export function getCombatProfile(card: CombatProfiled): CombatProfile {
  if (combatProfileIsValid(card.combatProfile)) return card.combatProfile;
  const previous = card.combatProfile as Partial<CombatProfile> | null | undefined;
  if (previous && typeof previous.role === 'string' && isStat(previous.power) && isStat(previous.stability) && isStat(previous.expertise)) {
    return { role: migrateCombatRoleId(previous.role, card.id), power: previous.power, stability: previous.stability, expertise: previous.expertise };
  }
  return deriveCombatProfile(card.id);
}

export function getCombatRoleInfo(profile: Pick<CombatProfile, 'role'>) {
  return COMBAT_ROLES.find(role => role.id === profile.role) ?? COMBAT_ROLES[0];
}

export function combatStatsModifier(profile: CombatProfile): -1 | 0 | 1 {
  const total = profile.power + profile.stability + profile.expertise;
  if (total <= 12) return -1;
  if (total >= 21) return 1;
  return 0;
}

export function combatProfileKey(profile: CombatProfile) {
  return `${profile.role}:${profile.power}:${profile.stability}:${profile.expertise}`;
}

export function randomCombatProfile(randomInt: (max: number) => number): CombatProfile {
  return {
    role: COMBAT_ROLES[randomInt(COMBAT_ROLES.length)].id,
    power: randomInt(10) + 1,
    stability: randomInt(10) + 1,
    expertise: randomInt(10) + 1,
  };
}

function hash32(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Stable fallback/backfill for cards that predate automatic profiles. */
export function deriveCombatProfile(seed: string, salt = 0): CombatProfile {
  const key = `${seed}\u0000${salt}`;
  return {
    role: COMBAT_ROLES[hash32(`${key}\u0000role`) % COMBAT_ROLES.length].id,
    power: hash32(`${key}\u0000power`) % 10 + 1,
    stability: hash32(`${key}\u0000stability`) % 10 + 1,
    expertise: hash32(`${key}\u0000expertise`) % 10 + 1,
  };
}
