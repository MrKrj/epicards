export type CardleAttributes = {
  id: string;
  name: string;
  rarity: string;
  category: string;
  set_name: string;
  booster_eligible: number | boolean;
};

export type CardleHint = 'correct' | 'wrong' | 'higher' | 'lower';
export type CardleFeedback = Record<'name' | 'nameLength' | 'rarity' | 'category' | 'series' | 'booster', CardleHint>;

const rarityOrder: Record<string, number> = {
  Commune: 0,
  'Peu commune': 1,
  Rare: 2,
  'Épique': 3,
  'Légendaire': 4,
  Secrète: 5,
};

function directionalHint(guess: number, answer: number): CardleHint {
  if (guess === answer) return 'correct';
  return answer > guess ? 'higher' : 'lower';
}

export function compareCardleGuess(answer: CardleAttributes, guess: CardleAttributes): CardleFeedback {
  const answerRarity = rarityOrder[answer.rarity] ?? -1;
  const guessRarity = rarityOrder[guess.rarity] ?? -1;
  return {
    name: answer.id === guess.id ? 'correct' : 'wrong',
    nameLength: directionalHint(Array.from(guess.name).length, Array.from(answer.name).length),
    rarity: answer.rarity === guess.rarity ? 'correct' : directionalHint(guessRarity, answerRarity),
    category: answer.category === guess.category ? 'correct' : 'wrong',
    series: answer.set_name === guess.set_name ? 'correct' : 'wrong',
    booster: Boolean(answer.booster_eligible) === Boolean(guess.booster_eligible) ? 'correct' : 'wrong',
  };
}
