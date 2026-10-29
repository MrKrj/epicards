import { randomInt } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/local-auth';
import { db } from '@/lib/local-db';

export const runtime = 'nodejs';

type DescribedCard = {
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
    WHERE c.id=? AND c.is_active=1 AND s.is_active=1`).get(id) as DescribedCard | undefined;
}

function getDailyPuzzle(day: string): DescribedCard | null {
  db.exec('BEGIN IMMEDIATE');
  try {
    let saved = db.prepare('SELECT card_id FROM described_card_daily WHERE puzzle_day=?').get(day) as { card_id: string } | undefined;
    let answer = saved ? cardById(saved.card_id) : undefined;
    if (!answer) {
      if (saved) {
        db.prepare('DELETE FROM described_card_guesses WHERE puzzle_day=?').run(day);
        db.prepare('DELETE FROM described_card_daily WHERE puzzle_day=?').run(day);
      }
      const pool = db.prepare(`SELECT c.id,c.name,c.description,c.rarity,c.category,c.image_url,
        s.name AS set_name FROM cards c JOIN card_sets s ON s.id=c.set_id
        WHERE c.is_active=1 AND s.is_active=1 AND trim(c.description)<>'' ORDER BY c.id`).all() as DescribedCard[];
      if (!pool.length) {
        db.exec('COMMIT');
        return null;
      }
      answer = pool[randomInt(pool.length)];
      db.prepare('INSERT INTO described_card_daily(puzzle_day,card_id,created_at) VALUES(?,?,?)')
        .run(day, answer.id, Date.now());
    }
    db.exec('COMMIT');
    return answer;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function responseFor(userId: number, day: string, answer: DescribedCard, awardedNow = false) {
  const options = db.prepare(`SELECT c.id,c.name FROM cards c JOIN card_sets s ON s.id=c.set_id
    WHERE c.is_active=1 AND s.is_active=1 ORDER BY c.name COLLATE NOCASE`).all() as
    Array<{ id: string; name: string }>;
  const guesses = db.prepare(`SELECT c.id,c.name FROM described_card_guesses g JOIN cards c ON c.id=g.guess_card_id
    WHERE g.user_id=? AND g.puzzle_day=? ORDER BY g.guess_order`).all(userId, day) as Array<{ id: string; name: string }>;
  const solved = guesses.some((guess) => guess.id === answer.id);
  const claimedReward = db.prepare('SELECT fragments FROM described_card_rewards WHERE user_id=? AND puzzle_day=?').get(userId, day) as
    { fragments: number } | undefined;
  return {
    day,
    description: answer.description,
    options,
    guesses: guesses.map((card) => ({ card, won: card.id === answer.id })),
    solved,
    completedToday: Boolean(claimedReward),
    answer: solved ? answer : undefined,
    reward: solved && claimedReward ? { fragments: claimedReward.fragments, claimed: true, awardedNow } : undefined,
  };
}

function grantDailyReward(userId: number, day: string) {
  if (db.prepare('SELECT 1 FROM described_card_rewards WHERE user_id=? AND puzzle_day=?').get(userId, day)) return false;
  const fragments = 50;
  db.prepare('UPDATE users SET points=points+? WHERE id=?').run(fragments, userId);
  const balance = (db.prepare('SELECT points FROM users WHERE id=?').get(userId) as { points: number }).points;
  const now = Date.now();
  db.prepare('INSERT INTO described_card_rewards(user_id,puzzle_day,fragments,created_at) VALUES(?,?,?,?)')
    .run(userId, day, fragments, now);
  db.prepare('INSERT INTO wallet_transactions(user_id,amount,balance_after,reason,reference_id,created_at) VALUES(?,?,?,?,?,?)')
    .run(userId, fragments, balance, 'récompense_jeu_carte_décrite', day, now);
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
    const answer = getDailyPuzzle(day);
    if (!answer) return NextResponse.json({ error: 'Ajoute des cartes actives avec une description pour lancer le jeu.' }, { status: 404 });
    const state = responseFor(auth.user.id, day, answer);
    if (state.solved && !state.reward) {
      let awardedNow = false;
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare('SELECT 1 FROM described_card_guesses WHERE user_id=? AND puzzle_day=? AND guess_card_id=?')
          .get(auth.user.id, day, answer.id)) awardedNow = grantDailyReward(auth.user.id, day);
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      }
      return NextResponse.json(responseFor(auth.user.id, day, answer, awardedNow));
    }
    return NextResponse.json(state);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Impossible de charger Carte décrite.' }, { status: 500 });
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
    const answer = getDailyPuzzle(day);
    if (!answer) return NextResponse.json({ error: 'Ajoute des cartes actives avec une description pour lancer le jeu.' }, { status: 404 });
    const guess = cardById(parsed.data.cardId);
    if (!guess) return NextResponse.json({ error: 'Cette carte n’est pas disponible.' }, { status: 404 });
    let awardedNow = false;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('SELECT 1 FROM described_card_guesses WHERE user_id=? AND puzzle_day=? AND guess_card_id=?')
        .get(auth.user.id, day, answer.id)) {
        db.exec('ROLLBACK');
        return NextResponse.json({ error: 'Tu as déjà trouvé la carte décrite du jour.' }, { status: 409 });
      }
      if (db.prepare('SELECT 1 FROM described_card_guesses WHERE user_id=? AND puzzle_day=? AND guess_card_id=?')
        .get(auth.user.id, day, guess.id)) {
        db.exec('ROLLBACK');
        return NextResponse.json({ error: 'Tu as déjà proposé cette carte.' }, { status: 409 });
      }
      const guessOrder = (db.prepare('SELECT COALESCE(MAX(guess_order),0)+1 AS next FROM described_card_guesses WHERE user_id=? AND puzzle_day=?')
        .get(auth.user.id, day) as { next: number }).next;
      db.prepare('INSERT INTO described_card_guesses(user_id,puzzle_day,guess_card_id,guess_order,created_at) VALUES(?,?,?,?,?)')
        .run(auth.user.id, day, guess.id, guessOrder, Date.now());
      if (guess.id === answer.id) awardedNow = grantDailyReward(auth.user.id, day);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
    return NextResponse.json(responseFor(auth.user.id, day, answer, awardedNow));
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
    const answer = getDailyPuzzle(day);
    if (!answer) return NextResponse.json({ error: 'Ajoute des cartes actives avec une description pour lancer le jeu.' }, { status: 404 });
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM described_card_guesses WHERE user_id=? AND puzzle_day=?').run(auth.user.id, day);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
    return NextResponse.json(responseFor(auth.user.id, day, answer));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Impossible de réinitialiser Carte décrite.' }, { status: 500 });
  }
}
