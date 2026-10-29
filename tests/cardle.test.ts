import { describe, expect, it } from 'vitest';
import { compareCardleGuess, type CardleAttributes } from '../lib/cardle';

const answer: CardleAttributes = {
  id: 'answer', name: 'Carte cible', rarity: 'Épique', category: 'Projets informatiques',
  set_name: 'Epitech', booster_eligible: 1,
};

describe('indices de Cardle', () => {
  it('valide tous les attributs lorsque la carte est trouvée', () => {
    expect(compareCardleGuess(answer, answer)).toEqual({
      name: 'correct', nameLength: 'correct', rarity: 'correct', category: 'correct', series: 'correct', booster: 'correct',
    });
  });

  it('indique si la rareté cible est au-dessus ou en dessous', () => {
    const guess = { ...answer, id: 'other', rarity: 'Commune' };
    const feedback = compareCardleGuess(answer, guess);
    expect(feedback.name).toBe('wrong');
    expect(feedback.rarity).toBe('higher');
  });

  it('valide séparément la catégorie, la série et l’éligibilité booster', () => {
    const feedback = compareCardleGuess(answer, { ...answer, id: 'other', category: 'Événements', set_name: 'Hackathons', booster_eligible: 0 });
    expect(feedback.category).toBe('wrong');
    expect(feedback.series).toBe('wrong');
    expect(feedback.booster).toBe('wrong');
  });

  it('indique si le nom cible est plus long ou plus court', () => {
    expect(compareCardleGuess({ ...answer, name: 'Carte mystère longue' }, { ...answer, id: 'short', name: 'Carte' }).nameLength).toBe('higher');
    expect(compareCardleGuess({ ...answer, name: 'Carte' }, { ...answer, id: 'long', name: 'Carte mystère longue' }).nameLength).toBe('lower');
  });
});
