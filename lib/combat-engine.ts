import { combatStatsModifier, getCombatProfile, getCombatRoleInfo, type CombatProfile } from './combat-profiles';

export const COMBAT_ROWS = ['melee', 'ranged', 'siege'] as const;
export type CombatRow = typeof COMBAT_ROWS[number];
export type CombatSide = 'p1' | 'p2';
export type CombatWeatherId = 'clear' | 'frost' | 'fog' | 'storm';

export const RARITY_POWER: Readonly<Record<string, number>> = {
  Commune: 3,
  'Peu commune': 2,
  Rare: 4,
  'Épique': 1,
  'Légendaire': 5,
  'Secrète': 2,
};

export const RARITY_EFFECT: Readonly<Record<string, string>> = {
  Commune: 'Aucun bonus',
  'Peu commune': 'Renforce les alliées',
  Rare: 'Double sa puissance',
  'Épique': 'Espion · neutralise un effet technique',
  'Légendaire': 'Ignore la météo',
  'Secrète': 'Retire les plus fortes',
};

export const WEATHER: Readonly<Record<CombatWeatherId, { name: string; row: CombatRow | null; description: string }>> = {
  clear: { name: 'Système nominal', row: null, description: 'Aucune anomalie détectée : les trois canaux fonctionnent normalement.' },
  frost: { name: 'Panne thermique', row: 'melee', description: 'Le canal Client surchauffe : les cartes non protégées y sont limitées à 1 puissance.' },
  fog: { name: 'Latence réseau', row: 'ranged', description: 'Le canal Réseau est ralenti : les cartes non protégées y sont limitées à 1 puissance.' },
  storm: { name: 'Surcharge serveur', row: 'siege', description: 'Le canal Serveur subit une surcharge : les cartes non protégées y sont limitées à 1 puissance. Pluie de données et éclairs signalent l’incident.' },
};

export type CombatCard = {
  id: string;
  name: string;
  rarity: string;
  category: string;
  setId: string;
  setName: string;
  imageUrl: string | null;
  isShiny: boolean;
  combatProfile: CombatProfile;
};

export function getCombatRarityExplanation(card: Pick<CombatCard, 'rarity' | 'setName'>) {
  switch (card.rarity) {
    case 'Peu commune': return 'Renforce les alliées : chaque Peu commune ajoute 1 point aux autres cartes alliées de son canal (maximum +2).';
    case 'Rare': return `Double ses points si une carte alliée de la série ${card.setName} est sur le même canal.`;
    case 'Épique': return 'Espion : va chez l’adversaire, mais ses points comptent pour toi. À son arrivée, elle neutralise l’effet technique de la carte adverse la plus puissante de ce canal jusqu’à la fin de la manche.';
    case 'Légendaire': return 'Ignore la météo et ne peut pas être détruite par une Secrète.';
    case 'Secrète': return 'Élimine les cartes adverses les plus puissantes du canal (sauf les Légendaires).';
    default: return 'Aucun effet spécial : base de 3 points.';
  }
}

export function getCombatBasePower(card: { id: string; rarity: string; combatProfile?: CombatProfile | null }) {
  return Math.max(1, (RARITY_POWER[card.rarity] ?? 1) + combatStatsModifier(getCombatProfile(card)));
}

export type BoardCard = CombatCard & {
  owner: CombatSide;
  technicalSuppressed?: boolean;
  stackTurns?: number;
  stackPower?: number;
  ramCarryover?: boolean;
  ramPower?: number;
  ciCdSourceIds?: string[];
  ciCdTargetCount?: number;
};
export type CombatPlayer = { id: number | null; username: string };
export type CombatLogEntry = { id: number; text: string; kind: 'play' | 'effect' | 'pass' | 'round' | 'weather' };
export type CombatPowerChange = { cardId: string; boardSide: CombatSide; row: CombatRow; change: number };

export type CombatState = {
  version: 2;
  mode: 'ai' | 'pvp';
  status: 'active' | 'finished';
  winner: CombatSide | 'draw' | null;
  players: Record<CombatSide, CombatPlayer>;
  round: number;
  turn: CombatSide;
  passed: CombatSide[];
  roundsWon: Record<CombatSide, number>;
  weatherId: CombatWeatherId;
  hands: Record<CombatSide, CombatCard[]>;
  drawPiles: Record<CombatSide, CombatCard[]>;
  discards: Record<CombatSide, CombatCard[]>;
  board: Record<CombatSide, Record<CombatRow, BoardCard[]>>;
  history: Array<{ round: number; winner: CombatSide | 'draw'; p1: number; p2: number; p1Lanes?:number; p2Lanes?:number; weather: CombatWeatherId }>;
  lastPowerChanges?: CombatPowerChange[];
  log: CombatLogEntry[];
  nextLogId: number;
};

export class CombatRuleError extends Error {}

const opponent = (side: CombatSide): CombatSide => side === 'p1' ? 'p2' : 'p1';
const emptyRows = (): Record<CombatRow, BoardCard[]> => ({ melee: [], ranged: [], siege: [] });
const shuffle = <T,>(items: T[], randomIndex: (max: number) => number): T[] => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

export function validateCombatDeck(cards: CombatCard[]): string | null {
  if (cards.length < 8 || cards.length > 12) return 'Choisis entre 8 et 12 cartes pour ton deck.';
  if (cards.some(card => !Object.hasOwn(RARITY_POWER, card.rarity))) return 'Une carte de ton deck a une rareté inconnue.';
  const keys = new Set(cards.map(card => card.id));
  if (keys.size !== cards.length) return 'Une même carte ne peut apparaître qu’une fois dans ton deck.';
  for (const rarity of ['Rare', 'Épique', 'Légendaire', 'Secrète']) {
    if (cards.filter(card => card.rarity === rarity).length > 1) return `Ton deck ne peut contenir qu’une carte ${rarity.toLowerCase()} au maximum.`;
  }
  return null;
}

export function createCombatState(args: {
  mode: 'ai' | 'pvp';
  player1: CombatPlayer;
  player2: CombatPlayer;
  deck1: CombatCard[];
  deck2: CombatCard[];
  randomIndex: (max: number) => number;
}): CombatState {
  const issue = validateCombatDeck(args.deck1) || validateCombatDeck(args.deck2);
  if (issue) throw new CombatRuleError(issue);
  const weatherIds: CombatWeatherId[] = ['clear', 'frost', 'fog', 'storm'];
  const randomWeather = () => weatherIds[args.randomIndex(weatherIds.length)];
  const openingWeather = randomWeather();
  const prepare = (deck: CombatCard[]) => shuffle(deck.map(card => ({ ...card, combatProfile: getCombatProfile(card) })), args.randomIndex);
  const hand1 = prepare(args.deck1);
  const hand2 = prepare(args.deck2);
  return {
    version: 2,
    mode: args.mode,
    status: 'active',
    winner: null,
    players: { p1: args.player1, p2: args.player2 },
    round: 1,
    turn: 'p1',
    passed: [],
    roundsWon: { p1: 0, p2: 0 },
    weatherId: openingWeather,
    hands: { p1: hand1, p2: hand2 },
    drawPiles: { p1: [], p2: [] },
    discards: { p1: [], p2: [] },
    board: { p1: emptyRows(), p2: emptyRows() },
    history: [],
    log: [{ id: 1, text: `Manche 1 · ${WEATHER[openingWeather].name}`, kind: 'weather' }],
    nextLogId: 2,
  };
}

function addLog(state: CombatState, text: string, kind: CombatLogEntry['kind']) {
  state.log.push({ id: state.nextLogId++, text, kind });
  if (state.log.length > 40) state.log.splice(0, state.log.length - 40);
}

function ownedCardsInRow(state: CombatState, owner: CombatSide, row: CombatRow) {
  return (['p1','p2'] as const).flatMap(boardSide => state.board[boardSide][row]).filter(card => card.owner === owner);
}

function allBoardCards(state: CombatState) {
  return (['p1','p2'] as const).flatMap(boardSide => COMBAT_ROWS.flatMap(row => state.board[boardSide][row].map(card => ({ boardSide, row, card }))));
}

function technicalRoleIsActive(card: BoardCard) {
  return !card.technicalSuppressed && !card.ramCarryover;
}

function boardCardKey(card: BoardCard) {
  return `${card.owner}:${card.id}:${card.isShiny ? 1 : 0}`;
}

function powerBeforeTechnicalEffects(state: CombatState, row: CombatRow, card: BoardCard) {
  if (card.ramCarryover) return Math.max(1, card.ramPower ?? 1);
  const allies = ownedCardsInRow(state, card.owner, row).filter(other => other !== card);
  let power = (RARITY_POWER[card.rarity] ?? 1) + combatStatsModifier(getCombatProfile(card));
  if (card.rarity === 'Rare' && allies.some(other => other.setId === card.setId)) power *= 2;
  if (allies.length) power += Math.min(2, allies.filter(other => other.rarity === 'Peu commune').length);
  if (WEATHER[state.weatherId].row === row && card.rarity !== 'Légendaire') power = 1;
  return Math.max(1, power);
}

type TechnicalEffect = { bonus: number; malus: number; active: boolean; role: ReturnType<typeof getCombatRoleInfo>; bonuses: string[]; maluses: string[]; notes: string[] };

function roleEffect(state: CombatState, row: CombatRow, card: BoardCard): TechnicalEffect {
  const profile = getCombatProfile(card);
  const role = getCombatRoleInfo(profile);
  const allies = ownedCardsInRow(state, card.owner, row).filter(other => other !== card);
  const enemies = ownedCardsInRow(state, opponent(card.owner), row);
  const bonuses: string[] = [];
  const maluses: string[] = [];
  const notes: string[] = [];
  let bonus = 0;
  let malus = 0;
  let active = false;

  if (card.ramCarryover) {
    notes.push(`RAM : cette carte est reportée une seule fois à ${Math.max(1, card.ramPower ?? 1)} puissance ; son effet technique ne se redéclenche pas.`);
    return { bonus, malus, active, role, bonuses, maluses, notes };
  }

  if (card.technicalSuppressed) notes.push(`Effet technique ${role.module} neutralisé par une Épique jusqu’à la fin de la manche.`);

  if (technicalRoleIsActive(card)) {
    switch (profile.role) {
      case 'ci_cd':
        if ((card.ciCdTargetCount ?? 0) > 0) {
          active = true;
          bonuses.push(`CI/CD : a donné +1 à ${card.ciCdTargetCount} carte${card.ciCdTargetCount === 1 ? '' : 's'} alliée${card.ciCdTargetCount === 1 ? '' : 's'} déjà présente${card.ciCdTargetCount === 1 ? '' : 's'} sur ce canal.`);
        }
        break;
      case 'api':
        bonus += 2;
        active = true;
        bonuses.push('API : +2 puissance sur elle-même.');
        break;
      case 'unit_test': {
        const strongestEnemy = [...enemies].sort((a, b) => powerBeforeTechnicalEffects(state, row, b) - powerBeforeTechnicalEffects(state, row, a))[0];
        if (strongestEnemy) {
          active = true;
          bonuses.push(`Unit Test : réduit de 2 la puissance de ${strongestEnemy.name}, la carte adverse la plus puissante de ce canal.`);
        }
        break;
      }
      case 'stack': {
        const stackPower = Math.max(0, Math.min(3, card.stackPower ?? 0));
        bonus += stackPower;
        active = stackPower > 0;
        if (stackPower) bonuses.push(`Stack : +${stackPower} puissance accumulée (maximum +3 par manche).`);
        else {
          const progress = Math.max(0, Math.min(1, card.stackTurns ?? 0));
          notes.push(`Stack : prochain +1 après ${2 - progress} carte${2 - progress === 1 ? '' : 's'} jouée${2 - progress === 1 ? '' : 's'} après elle.`);
        }
        break;
      }
      case 'ram':
        active = true;
        bonuses.push(`RAM : si elle est encore en jeu à la fin de la manche, elle reviendra une fois à ${Math.max(1, Math.floor(powerBeforeTechnicalEffects(state, row, card) / 2))} puissance.`);
        break;
      case 'elasticity_cloud': {
        const targets = allBoardCards(state).filter(entry => entry.card.owner === card.owner && entry.row !== row);
        const strongest = [...targets].sort((a, b) => powerBeforeTechnicalEffects(state, b.row, b.card) - powerBeforeTechnicalEffects(state, a.row, a.card))[0];
        if (strongest) {
          active = true;
          bonuses.push(`Elasticity Cloud : renforce ${strongest.card.name} (+1), la carte alliée la plus puissante hors de ce canal.`);
        } else notes.push('Elasticity Cloud : en attente d’une carte alliée sur un autre canal.');
        break;
      }
    }
  }

  // CI/CD's deployment bonus is stored on its original targets. A silenced or
  // removed source immediately stops contributing for the rest of the round.
  const sourceKeys = new Set(card.ciCdSourceIds ?? []);
  const ciCdSources = allies.filter(other => getCombatProfile(other).role === 'ci_cd' && technicalRoleIsActive(other) && sourceKeys.has(boardCardKey(other)));
  if (ciCdSources.length) {
    bonus += ciCdSources.length;
    active = true;
    bonuses.push(`CI/CD : +${ciCdSources.length} puissance grâce aux cartes alliées de ce canal.`);
  }

  // Unit Test is an aura that lowers only the strongest opposing unit on its lane.
  const unitTestSources = enemies.filter(enemy => getCombatProfile(enemy).role === 'unit_test' && technicalRoleIsActive(enemy));
  if (unitTestSources.length) {
    const strongestOwn = [...ownedCardsInRow(state, card.owner, row)].sort((a, b) => powerBeforeTechnicalEffects(state, row, b) - powerBeforeTechnicalEffects(state, row, a))[0];
    if (strongestOwn === card) {
      malus = -2 * unitTestSources.length;
      active = true;
      maluses.push(`Unit Test adverse : −${Math.abs(malus)} puissance, car tu es la carte la plus puissante de ce canal.`);
    }
  }

  // Each Cloud role lends +1 to the strongest ally on any other channel.
  const cloudSources = allBoardCards(state).filter(entry => entry.card.owner === card.owner && entry.row !== row && getCombatProfile(entry.card).role === 'elasticity_cloud' && technicalRoleIsActive(entry.card));
  const cloudBoostCount = cloudSources.filter(source => {
    const candidates = allBoardCards(state).filter(entry => entry.card.owner === card.owner && entry.row !== source.row);
    const strongest = [...candidates].sort((a, b) => powerBeforeTechnicalEffects(state, b.row, b.card) - powerBeforeTechnicalEffects(state, a.row, a.card))[0];
    return strongest?.card === card && strongest.row === row;
  }).length;
  if (cloudBoostCount) {
    bonus += cloudBoostCount;
    active = true;
    bonuses.push(`Elasticity Cloud : +${cloudBoostCount} puissance, car elle est la carte alliée la plus puissante d’un autre canal.`);
  }

  return { bonus, malus, active, role, bonuses, maluses, notes };
}

function powerWithoutWeather(state: CombatState, row: CombatRow, card: BoardCard): number {
  if (card.ramCarryover) return Math.max(1, card.ramPower ?? 1);
  const allies = ownedCardsInRow(state, card.owner, row).filter(other => other !== card);
  let power = (RARITY_POWER[card.rarity] ?? 1) + combatStatsModifier(getCombatProfile(card));
  if (card.rarity === 'Rare' && allies.some(other => other.setId === card.setId)) power *= 2;
  if (allies.length) power += Math.min(2, allies.filter(other => other.rarity === 'Peu commune').length);
  const technical = roleEffect(state, row, card);
  power += technical.bonus + technical.malus;
  return Math.max(1, power);
}

export function effectiveCardPower(state: CombatState, side: CombatSide, row: CombatRow, card: BoardCard): number {
  const weather = WEATHER[state.weatherId];
  if (weather.row === row && card.rarity !== 'Légendaire') return 1;
  return powerWithoutWeather(state, row, card);
}

function boardPowerSnapshot(state: CombatState) {
  const powers = new Map<string, number>();
  for (const boardSide of ['p1','p2'] as const) for (const row of COMBAT_ROWS) {
    for (const card of state.board[boardSide][row]) powers.set(`${boardSide}:${row}:${card.id}`, effectiveCardPower(state, boardSide, row, card));
  }
  return powers;
}

function boardPowerChanges(state: CombatState, before: Map<string, number>) {
  return (['p1','p2'] as const).flatMap(boardSide => COMBAT_ROWS.flatMap(row => state.board[boardSide][row].flatMap(card => {
    const previous = before.get(`${boardSide}:${row}:${card.id}`);
    const current = effectiveCardPower(state, boardSide, row, card);
    return previous !== undefined && current !== previous ? [{ card, boardSide, row, change: current - previous }] : [];
  })));
}

function advanceStacks(state: CombatState) {
  for (const { card } of allBoardCards(state)) {
    if (getCombatProfile(card).role !== 'stack' || !technicalRoleIsActive(card)) continue;
    const turns = (card.stackTurns ?? 0) + 1;
    if (turns >= 2) {
      card.stackPower = Math.min(3, (card.stackPower ?? 0) + 1);
      card.stackTurns = 0;
    } else card.stackTurns = turns;
  }
}

export function getBoardScore(state: CombatState, side: CombatSide): number {
  return (['p1','p2'] as const).reduce((sum, boardSide) => sum + COMBAT_ROWS.reduce((rowSum, row) => rowSum + state.board[boardSide][row].reduce((cardSum, card) => cardSum + (card.owner === side ? effectiveCardPower(state, boardSide, row, card) : 0), 0), 0), 0);
}

export function getCombatRowScore(state: CombatState, side: CombatSide, row: CombatRow): number {
  return (['p1','p2'] as const).reduce((sum, boardSide) => sum + state.board[boardSide][row].reduce((rowSum, card) => rowSum + (card.owner === side ? effectiveCardPower(state, boardSide, row, card) : 0), 0), 0);
}

export function playCombatCard(state: CombatState, side: CombatSide, cardId: string, row: CombatRow): CombatState {
  if (state.status !== 'active') throw new CombatRuleError('Ce combat est déjà terminé.');
  if (state.turn !== side) throw new CombatRuleError('Ce n’est pas ton tour.');
  if (state.passed.includes(side)) throw new CombatRuleError('Tu as passé cette manche.');
  if (!COMBAT_ROWS.includes(row)) throw new CombatRuleError('Canal invalide.');
  const index = state.hands[side].findIndex(card => card.id === cardId);
  if (index < 0) throw new CombatRuleError('Cette carte n’est pas dans ta main.');
  const [card] = state.hands[side].splice(index, 1);
  const other = opponent(side);
  const boardPowersBefore = boardPowerSnapshot(state);
  let killSwitchResult = '';
  advanceStacks(state);

  if (card.rarity === 'Secrète') {
    const targets = state.board[other][row].filter(target => target.owner === other && target.rarity !== 'Légendaire');
    if (targets.length) {
      const strongest = Math.max(...targets.map(target => effectiveCardPower(state, other, row, target)));
      const destroyed = targets.filter(target => effectiveCardPower(state, other, row, target) === strongest);
      state.board[other][row] = state.board[other][row].filter(target => !destroyed.includes(target));
      for (const target of destroyed) state.discards[target.owner].push(target);
      killSwitchResult = `Neutralisation : ${destroyed.map(target => target.name).join(', ')} ${destroyed.length === 1 ? 'détruite' : 'détruites'} dans ce canal.`;
    } else {
      killSwitchResult = 'Neutralisation : aucune carte adverse destructible sur ce canal.';
    }
  }

  const boardSide = card.rarity === 'Épique' ? other : side;
  const playedCard: BoardCard = { ...card, combatProfile: getCombatProfile(card), owner: side, ...(getCombatProfile(card).role === 'stack' ? { stackTurns: 0, stackPower: 0 } : {}) };
  if (getCombatProfile(playedCard).role === 'ci_cd') {
    const targets = ownedCardsInRow(state, side, row);
    playedCard.ciCdTargetCount = targets.length;
    const sourceId = boardCardKey(playedCard);
    for (const target of targets) target.ciCdSourceIds = [...new Set([...(target.ciCdSourceIds ?? []), sourceId])];
  }
  state.board[boardSide][row].push(playedCard);
  let epicSuppressionResult = '';
  if (card.rarity === 'Épique') {
    const targets = ownedCardsInRow(state, other, row).filter(target => !target.technicalSuppressed);
    const strongest = [...targets].sort((a, b) => effectiveCardPower(state, other, row, b) - effectiveCardPower(state, other, row, a))[0];
    if (strongest) {
      strongest.technicalSuppressed = true;
      epicSuppressionResult = ` Effet ${getCombatRoleInfo(getCombatProfile(strongest)).module} de ${strongest.name} neutralisé jusqu’à la fin de la manche.`;
    } else epicSuppressionResult = ' Aucun effet technique adverse à neutraliser sur ce canal.';
  }
  const rowLabel = row === 'melee' ? 'Client' : row === 'ranged' ? 'Réseau' : 'Serveur';
  addLog(state, `${state.players[side].username} déploie ${card.name} sur le canal ${rowLabel}${boardSide !== side ? ' · fork côté adverse' : ''}.`, 'play');
  const changedCards = boardPowerChanges(state, boardPowersBefore);
  state.lastPowerChanges = changedCards.map(({card,boardSide,row,change})=>({cardId:card.id,boardSide,row,change}));

  let activation = '';
  if (card.rarity === 'Épique') {
    activation = `Espion : posée côté adverse, ses points sont pour toi.${epicSuppressionResult}`;
  } else if (card.rarity === 'Peu commune') {
    const anotherProtocol = ownedCardsInRow(state, side, row).some(ally => ally.id !== card.id && ally.rarity === 'Peu commune');
    activation = WEATHER[state.weatherId].row === row
      ? `Renfort bloqué par ${WEATHER[state.weatherId].name} : les cartes de ce canal sont limitées à 1 puissance.`
      : anotherProtocol
        ? `Renfort actif sur ${rowLabel} : tes autres cartes de ce canal gagnent de la puissance.`
        : 'Renfort en attente : pose une autre Peu commune alliée sur ce canal pour activer le bonus.';
  } else if (card.rarity === 'Rare') {
    const partner = ownedCardsInRow(state, side, row).find(ally => ally.id !== card.id && ally.setId === card.setId);
    activation = partner
      ? WEATHER[state.weatherId].row === row
        ? `Double puissance liée à ${partner.name}, mais ${WEATHER[state.weatherId].name} limite ce canal à 1.`
        : `Double puissance : ${card.name} est associée à ${partner.name} de la même série.`
      : `Double puissance en attente : pose une carte alliée de la série ${card.setName} sur ce canal.`;
  } else if (card.rarity === 'Légendaire') {
    activation = 'Protection : cette carte ignore la météo et ne peut pas être détruite par une Secrète.';
  } else if (card.rarity === 'Secrète') {
    activation = killSwitchResult;
  } else {
    activation = WEATHER[state.weatherId].row === row
      ? `Aucun effet de rareté. Puissance de base ${RARITY_POWER[card.rarity] ?? 1}, limitée à 1 par ${WEATHER[state.weatherId].name}.`
      : `Aucun effet de rareté. Puissance de base : ${RARITY_POWER[card.rarity] ?? 1}.`;
  }
  const role = roleEffect(state, row, playedCard);
  const finalPower = effectiveCardPower(state, boardSide, row, playedCard);
  const weatherLimitsCard = WEATHER[state.weatherId].row === row && card.rarity !== 'Légendaire';
  const roleResult = role.active
    ? `Effet ${role.role.module} : ${[...role.bonuses, ...role.maluses, ...role.notes].join(' ')}`
    : `Effet ${role.role.module} en attente : ${role.role.description}`;
  const interactionResult = changedCards.length
    ? ` Variations sur le plateau : ${changedCards.map(change => `${change.card.name} ${change.change > 0 ? '+' : '−'}${Math.abs(change.change)}`).join(', ')}.`
    : '';
  activation = `${activation} ${roleResult}${weatherLimitsCard ? ` Puissance finale limitée à ${finalPower} par ${WEATHER[state.weatherId].name}.` : ` Puissance finale : ${finalPower}.`}${interactionResult}`;
  addLog(state, activation, 'effect');

  advanceTurn(state, side);
  return state;
}

export function passCombatRound(state: CombatState, side: CombatSide): CombatState {
  if (state.status !== 'active') throw new CombatRuleError('Ce combat est déjà terminé.');
  if (state.turn !== side) throw new CombatRuleError('Ce n’est pas ton tour.');
  if (!state.passed.includes(side)) state.passed.push(side);
  addLog(state, `${state.players[side].username} passe la manche.`, 'pass');
  advanceTurn(state, side);
  return state;
}

function advanceTurn(state: CombatState, acted: CombatSide) {
  const other = opponent(acted);
  autoPassEmptyHands(state);
  if (state.passed.includes('p1') && state.passed.includes('p2')) {
    resolveRound(state);
    return;
  }
  state.turn = state.passed.includes(other) ? acted : other;
}

function autoPassEmptyHands(state: CombatState) {
  for (const side of ['p1','p2'] as const) {
    if (state.hands[side].length === 0 && !state.passed.includes(side)) {
      state.passed.push(side);
      addLog(state, `${state.players[side].username} n’a plus de carte : passe automatiquement la manche.`, 'pass');
    }
  }
}

function resolveRound(state: CombatState) {
  const p1 = getBoardScore(state, 'p1');
  const p2 = getBoardScore(state, 'p2');
  const laneWins={p1:0,p2:0};
  for(const row of COMBAT_ROWS){const p1Row=getCombatRowScore(state,'p1',row),p2Row=getCombatRowScore(state,'p2',row);if(p1Row>p2Row)laneWins.p1++;else if(p2Row>p1Row)laneWins.p2++}
  const winner: CombatSide | 'draw' = laneWins.p1>=2?'p1':laneWins.p2>=2?'p2':'draw';
  state.history.push({ round: state.round, winner, p1, p2, p1Lanes:laneWins.p1, p2Lanes:laneWins.p2, weather: state.weatherId });
  if (winner !== 'draw') state.roundsWon[winner] += 1;
  addLog(state, winner === 'draw' ? `Manche ${state.round} · aucun camp ne prend deux lignes (${laneWins.p1}–${laneWins.p2} lignes ; ${p1}–${p2} points).` : `Manche ${state.round} remportée par ${state.players[winner].username} · ${laneWins[winner]} lignes à ${laneWins[opponent(winner)]} · ${p1}–${p2} points.`, 'round');

  if (state.roundsWon.p1 >= 2 || state.roundsWon.p2 >= 2 || state.round >= 3) {
    state.status = 'finished';
    state.winner = state.roundsWon.p1 === state.roundsWon.p2 ? 'draw' : state.roundsWon.p1 > state.roundsWon.p2 ? 'p1' : 'p2';
    addLog(state, state.winner === 'draw' ? 'Combat terminé · match nul.' : `${state.players[state.winner].username} remporte le combat !`, 'round');
    return;
  }

  const ramCarryovers: Array<{ boardSide: CombatSide; row: CombatRow; card: BoardCard }> = [];
  for (const side of ['p1', 'p2'] as const) {
    for (const row of COMBAT_ROWS) {
      for (const card of state.board[side][row]) {
        if (getCombatProfile(card).role === 'ram' && !card.technicalSuppressed && !card.ramCarryover) {
          const lastPower = effectiveCardPower(state, side, row, card);
          const ramPower = Math.max(1, Math.floor(lastPower / 2));
          const carried = { ...card, ramCarryover: true, ramPower, stackPower: 0, stackTurns: 0 };
          ramCarryovers.push({ boardSide: side, row, card: carried });
          addLog(state, `RAM : ${card.name} persiste à ${ramPower} puissance pour la manche ${state.round + 1}.`, 'effect');
        } else state.discards[card.owner].push(card);
      }
    }
  }
  state.board = { p1: emptyRows(), p2: emptyRows() };
  for (const carryover of ramCarryovers) state.board[carryover.boardSide][carryover.row].push(carryover.card);
  state.lastPowerChanges = [];
  state.round += 1;
  state.passed = [];
  state.turn = winner === 'draw' ? (state.round % 2 === 0 ? 'p2' : 'p1') : winner;
  const weatherIds: CombatWeatherId[] = ['clear', 'frost', 'fog', 'storm'];
  state.weatherId = weatherIds[Math.floor(Math.random() * weatherIds.length)];
  addLog(state, `Manche ${state.round} · ${WEATHER[state.weatherId].name}`, 'weather');
  autoPassEmptyHands(state);
  if (state.passed.includes('p1') && state.passed.includes('p2')) resolveRound(state);
  else if (state.passed.includes(state.turn)) state.turn = opponent(state.turn);
}

export function resolveComputerTurns(state: CombatState, randomIndex: (max: number) => number): CombatState {
  let safety = 0;
  while (state.status === 'active' && state.turn === 'p2' && safety++ < 20) resolveComputerTurn(state, randomIndex);
  return state;
}

/** Resolve a single AI decision so clients can animate it before requesting the next one. */
export function resolveComputerTurn(state: CombatState, randomIndex: (max: number) => number): CombatState {
  if (state.status !== 'active' || state.turn !== 'p2') return state;
  if (state.passed.includes('p2')) {
    advanceTurn(state, 'p2');
    return state;
  }
  const hand = state.hands.p2;
  if (hand.length === 0) {
    advanceTurn(state, 'p2');
    return state;
  }
  const myScore = getBoardScore(state, 'p2');
  const theirScore = getBoardScore(state, 'p1');
  const ahead = myScore > theirScore;
  const conserve = (state.round < 3 && ahead && hand.length <= state.hands.p1.length && myScore - theirScore >= 2) || hand.length === 0;
  if (conserve) {
    passCombatRound(state, 'p2');
    return state;
  }
  const choices: Array<{ card: CombatCard; row: CombatRow; value: number }> = [];
  for (const card of hand) {
    for (const row of COMBAT_ROWS) {
      const weatherPenalty = WEATHER[state.weatherId].row === row && card.rarity !== 'Légendaire' ? -2 : 0;
      const sameSeries = state.board.p2[row].some(other => other.setId === card.setId);
      const enemyPower = Math.max(0, ...state.board.p1[row].map(other => effectiveCardPower(state, 'p1', row, other)));
      const ability = card.rarity === 'Rare' && sameSeries ? 4 : card.rarity === 'Secrète' && enemyPower >= 4 ? 4 : card.rarity === 'Épique' ? 2 : card.rarity === 'Peu commune' ? state.board.p2[row].length : 0;
      const crowd = state.board.p2[row].length * -0.04;
      const candidate={...card,owner:'p2' as const};
      const profileBonus=combatStatsModifier(getCombatProfile(card));
      const roleInfo=roleEffect(state,row,candidate);
      const roleId=getCombatProfile(card).role;
      const rolePotential=roleId==='ci_cd'?state.board.p2[row].length:roleId==='unit_test'&&state.board.p1[row].length?2:roleId==='elasticity_cloud'&&COMBAT_ROWS.some(otherRow=>otherRow!==row&&ownedCardsInRow(state,'p2',otherRow).length>0)?1:roleId==='stack'?0.8:roleId==='ram'?1:0;
      const epicSuppression=card.rarity==='Épique'&&state.board.p1[row].length?1.5:0;
      choices.push({ card, row, value: (RARITY_POWER[card.rarity] ?? 1) + profileBonus + roleInfo.bonus + rolePotential + epicSuppression + weatherPenalty + ability + crowd });
    }
  }
  choices.sort((a, b) => b.value - a.value);
  const best = choices.length ? choices[Math.min(randomIndex(Math.min(2, choices.length)), Math.max(0, choices.length - 1))] : null;
  if (!best) passCombatRound(state, 'p2');
  else playCombatCard(state, 'p2', best.card.id, best.row);
  return state;
}

export function makeAllUnplayedCardsAvailable(state: CombatState) {
  // Complete matches saved with the previous reserve rule when they are resumed.
  for (const side of ['p1','p2'] as const) {
    const reserve = state.drawPiles?.[side] ?? [];
    if (reserve.length) state.hands[side].push(...reserve.splice(0));
  }
  return state;
}

export function combatSnapshot(state: CombatState, viewer: CombatSide) {
  makeAllUnplayedCardsAvailable(state);
  const other = opponent(viewer);
  const score = { p1: getBoardScore(state, 'p1'), p2: getBoardScore(state, 'p2') };
  const rowScore = { p1: { melee: getCombatRowScore(state,'p1','melee'), ranged: getCombatRowScore(state,'p1','ranged'), siege: getCombatRowScore(state,'p1','siege') }, p2: { melee: getCombatRowScore(state,'p2','melee'), ranged: getCombatRowScore(state,'p2','ranged'), siege: getCombatRowScore(state,'p2','siege') } };
  const board = Object.fromEntries((['p1','p2'] as const).map(boardSide => [boardSide, Object.fromEntries(COMBAT_ROWS.map(row => [row, state.board[boardSide][row].map(card => {
    const power = effectiveCardPower(state, boardSide, row, card);
    const bonuses: string[] = [];
    const maluses: string[] = [];
    const notes: string[] = [];
    const naturalPower = powerWithoutWeather(state, row, card);
    const lastChange=state.lastPowerChanges?.find(change=>change.cardId===card.id&&change.boardSide===boardSide&&change.row===row);
    if(lastChange)(lastChange.change>0?bonuses:maluses).push(lastChange.change>0?`Dernière pose : ${card.name} gagne +${lastChange.change} puissance.`:`Dernière pose : ${card.name} perd −${Math.abs(lastChange.change)} puissance.`);
    const allies = ownedCardsInRow(state, card.owner, row).filter(ally => ally !== card);
    const protocolBoost = Math.min(2, allies.filter(ally => ally.rarity === 'Peu commune').length);
    if (protocolBoost > 0) bonuses.push(`Renfort actif : +${protocolBoost} puissance grâce aux Peu communes alliées.`);
    if (card.rarity === 'Rare') {
      const partner = allies.find(ally => ally.setId === card.setId);
      if (partner) bonuses.push(`Double puissance grâce à ${partner.name} de la même série.`);
    }
    if (card.rarity === 'Légendaire' && WEATHER[state.weatherId].row === row) bonuses.push('Protection active : cette carte ignore l’incident météo.');
    const role = roleEffect(state, row, card);
    bonuses.push(...role.bonuses);
    maluses.push(...role.maluses);
    notes.push(...role.notes);
    if (WEATHER[state.weatherId].row === row && card.rarity !== 'Légendaire' && naturalPower > power) {
      maluses.push(`${WEATHER[state.weatherId].name} : puissance réduite de ${naturalPower} à ${power} sur ce canal.`);
      if (role.bonus || role.malus) notes.push(`L’incident météo plafonne le score à ${power} : les autres effets ne changent pas ce total.`);
    }
    const effectReasons = [...bonuses, ...maluses, ...notes];
    const effectTone = bonuses.length&&maluses.length?'mixed' as const:maluses.length?'negative' as const:bonuses.length?'positive' as const:null;
    return { ...card, power, effectTone, effectReasons, effectBonuses: bonuses, effectMaluses: maluses, effectNotes: notes };
  })]))])) as Record<CombatSide, Record<CombatRow, Array<BoardCard & { power: number; effectTone: 'positive' | 'negative' | 'mixed' | null; effectReasons: string[]; effectBonuses: string[]; effectMaluses: string[]; effectNotes: string[] }>>>;
  return {
    version: state.version,
    mode: state.mode,
    status: state.status,
    winner: state.winner,
    players: state.players,
    round: state.round,
    turn: state.turn,
    viewer,
    passed: state.passed,
    roundsWon: state.roundsWon,
    weather: { id: state.weatherId, ...WEATHER[state.weatherId] },
    hand: state.hands[viewer],
    handCount: state.hands[viewer].length,
    opponentHandCount: state.hands[other].length,
    board,
    score,
    rowScore,
    history: state.history,
    log: state.log.slice(-18),
  };
}
