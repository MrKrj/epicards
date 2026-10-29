import { randomInt } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';

export const runtime = 'nodejs';

type PuzzleCard = {
  id: string;
  name: string;
  description: string;
  rarity: string;
  category: string;
  image_url: string | null;
  set_name: string;
};

function puzzleDay() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function cardById(id: string) {
  return db.prepare(`SELECT c.id,c.name,c.description,c.rarity,c.category,c.image_url,
    s.name AS set_name FROM cards c JOIN card_sets s ON s.id=c.set_id
    WHERE c.id=? AND c.is_active=1 AND s.is_active=1`).get(id) as PuzzleCard | undefined;
}

function getDailyPuzzle(day: string) {
  db.exec('BEGIN IMMEDIATE');
  try {
    let saved = db.prepare('SELECT card_id,focus_x,focus_y FROM blurred_card_daily WHERE puzzle_day=?').get(day) as
      { card_id: string; focus_x: number; focus_y: number } | undefined;
    let answer = saved ? cardById(saved.card_id) : undefined;
    if (!answer) {
      if (saved) {
        db.prepare('DELETE FROM blurred_card_guesses WHERE puzzle_day=?').run(day);
        db.prepare('DELETE FROM blurred_card_daily WHERE puzzle_day=?').run(day);
      }
      const pool = db.prepare(`SELECT c.id,c.name,c.description,c.rarity,c.category,c.image_url,
        s.name AS set_name FROM cards c JOIN card_sets s ON s.id=c.set_id
        WHERE c.is_active=1 AND s.is_active=1 AND c.image_url IS NOT NULL AND trim(c.image_url)<>''
        ORDER BY c.id`).all() as PuzzleCard[];
      if (!pool.length) {
        db.exec('COMMIT');
        return null;
      }
      answer = pool[randomInt(pool.length)];
      saved = { card_id: answer.id, focus_x: randomInt(22, 79), focus_y: randomInt(22, 79) };
      db.prepare('INSERT INTO blurred_card_daily(puzzle_day,card_id,focus_x,focus_y,created_at) VALUES(?,?,?,?,?)')
        .run(day, answer.id, saved.focus_x, saved.focus_y, Date.now());
    }
    db.exec('COMMIT');
    return { answer, focusX: saved!.focus_x, focusY: saved!.focus_y };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function responseFor(userId: number, day: string, answer: PuzzleCard, focusX: number, focusY: number, awardedNow = false) {
  const options = db.prepare(`SELECT id,name FROM cards WHERE is_active=1 ORDER BY name COLLATE NOCASE`).all() as
    Array<{ id: string; name: string }>;
  const guesses = db.prepare(`SELECT c.id,c.name FROM blurred_card_guesses g JOIN cards c ON c.id=g.guess_card_id
    WHERE g.user_id=? AND g.puzzle_day=? ORDER BY g.guess_order`).all(userId, day) as Array<{ id: string; name: string }>;
  const solved = guesses.some((guess) => guess.id === answer.id);
  const wrongCount = guesses.filter((guess) => guess.id !== answer.id).length;
  const claimedReward = db.prepare('SELECT fragments FROM blurred_card_rewards WHERE user_id=? AND puzzle_day=?').get(userId, day) as { fragments: number } | undefined;
  const rewardRow = solved ? claimedReward : undefined;
  return {
    day,
    options,
    guesses: guesses.map((card) => ({ card, won: card.id === answer.id })),
    solved,
    completedToday: Boolean(claimedReward),
    image_url: answer.image_url,
    focus_x: focusX,
    focus_y: focusY,
    reveal_level: solved ? 6 : Math.min(6, wrongCount),
    answer: solved ? answer : undefined,
    reward: rewardRow ? { fragments: rewardRow.fragments, claimed: true, awardedNow } : undefined,
  };
}

function grantDailyReward(userId: number, day: string) {
  if (db.prepare('SELECT 1 FROM blurred_card_rewards WHERE user_id=? AND puzzle_day=?').get(userId, day)) return false;
  const fragments = 50;
  db.prepare('UPDATE users SET points=points+? WHERE id=?').run(fragments, userId);
  const balance = (db.prepare('SELECT points FROM users WHERE id=?').get(userId) as { points: number }).points;
  const now = Date.now();
  db.prepare('INSERT INTO blurred_card_rewards(user_id,puzzle_day,fragments,created_at) VALUES(?,?,?,?)').run(userId, day, fragments, now);
  db.prepare('INSERT INTO wallet_transactions(user_id,amount,balance_after,reason,reference_id,created_at) VALUES(?,?,?,?,?,?)')
    .run(userId, fragments, balance, 'récompense_jeu_carte_floutée', day, now);
  return true;
}

async function authenticatedUser() {
  const user = await currentUser();
  if (!user) return { user: null, response: NextResponse.json({ error: 'Connexion requise.' }, { status: 401 }) };
  return { user, response: null };
}

export async function GET() {
  const auth = await authenticatedUser();
  if (auth.response || !auth.user) return auth.response;
  try {
    const day = puzzleDay();
    const puzzle = getDailyPuzzle(day);
    if (!puzzle) return NextResponse.json({ error: 'Ajoute des cartes actives avec une illustration pour lancer le jeu.' }, { status: 404 });
    const state = responseFor(auth.user.id, day, puzzle.answer, puzzle.focusX, puzzle.focusY);
    if (state.solved && !state.reward) {
      let awardedNow = false;
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare('SELECT 1 FROM blurred_card_guesses WHERE user_id=? AND puzzle_day=? AND guess_card_id=?')
          .get(auth.user.id, day, puzzle.answer.id)) awardedNow = grantDailyReward(auth.user.id, day);
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      }
      return NextResponse.json(responseFor(auth.user.id, day, puzzle.answer, puzzle.focusX, puzzle.focusY, awardedNow));
    }
    return NextResponse.json(state);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Impossible de charger le jeu du jour.' }, { status: 500 });
  }
}

const guessSchema = z.object({ cardId: z.string().min(1).max(100) });

export async function POST(request: Request) {
  const auth = await authenticatedUser();
  if (auth.response || !auth.user) return auth.response;
  const parsed = guessSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Choisis une carte valide.' }, { status: 400 });
  try {
    const day = puzzleDay();
    const puzzle = getDailyPuzzle(day);
    if (!puzzle) return NextResponse.json({ error: 'Ajoute des cartes actives avec une illustration pour lancer le jeu.' }, { status: 404 });
    const guess = cardById(parsed.data.cardId);
    if (!guess) return NextResponse.json({ error: 'Cette carte n’est pas disponible.' }, { status: 404 });
    let awardedNow = false;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('SELECT 1 FROM blurred_card_guesses WHERE user_id=? AND puzzle_day=? AND guess_card_id=?')
        .get(auth.user.id, day, puzzle.answer.id)) {
        db.exec('ROLLBACK');
        return NextResponse.json({ error: 'Tu as déjà trouvé la carte du jour.' }, { status: 409 });
      }
      if (db.prepare('SELECT 1 FROM blurred_card_guesses WHERE user_id=? AND puzzle_day=? AND guess_card_id=?')
        .get(auth.user.id, day, guess.id)) {
        db.exec('ROLLBACK');
        return NextResponse.json({ error: 'Tu as déjà proposé cette carte.' }, { status: 409 });
      }
      const guessOrder = (db.prepare('SELECT COALESCE(MAX(guess_order),0)+1 AS next FROM blurred_card_guesses WHERE user_id=? AND puzzle_day=?')
        .get(auth.user.id, day) as { next: number }).next;
      db.prepare('INSERT INTO blurred_card_guesses(user_id,puzzle_day,guess_card_id,guess_order,created_at) VALUES(?,?,?,?,?)')
        .run(auth.user.id, day, guess.id, guessOrder, Date.now());
      if (guess.id === puzzle.answer.id) awardedNow = grantDailyReward(auth.user.id, day);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
    return NextResponse.json(responseFor(auth.user.id, day, puzzle.answer, puzzle.focusX, puzzle.focusY, awardedNow));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Impossible d’enregistrer cette proposition.' }, { status: 500 });
  }
}

export async function DELETE() {
  const auth = await authenticatedUser();
  if (auth.response || !auth.user) return auth.response;
  if (auth.user.role !== 'admin') return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 });
  try {
    const day = puzzleDay();
    const puzzle = getDailyPuzzle(day);
    if (!puzzle) return NextResponse.json({ error: 'Ajoute des cartes actives avec une illustration pour lancer le jeu.' }, { status: 404 });
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM blurred_card_guesses WHERE user_id=? AND puzzle_day=?').run(auth.user.id, day);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
    return NextResponse.json(responseFor(auth.user.id, day, puzzle.answer, puzzle.focusX, puzzle.focusY));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Impossible de réinitialiser la partie.' }, { status: 500 });
  }
}
