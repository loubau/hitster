import { describe, expect, it } from 'vitest';
import { newGame, reduce, type Action } from './game';
import { autoSlot, correctSlots, fitsAt } from './rules';
import type { Card, GameState, Settings } from './types';

function card(id: string, lo: number, hi = lo): Card {
  return {
    id,
    set: 'regular',
    year: Math.round((lo + hi) / 2),
    yearLo: lo,
    yearHi: hi,
    yearLabel: String(lo),
    primary: id,
    secondary: id,
    primaryLabel: 'Artist',
    secondaryLabel: 'Title',
    trivia: '',
    facts: [],
    region: 'intl',
    tags: [],
  };
}

const settings: Settings = {
  sets: ['regular'],
  target: 10,
  startChips: 2,
  maxChips: 5,
  variant: 'original',
  includeDutch: true,
  allowBuy: true,
  allowSkip: true,
};

const play = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);

/** A game with fixed timelines and a known mystery card, independent of shuffling. */
function rigged(timelines: Card[][], current: Card, deck: Card[] = [card('spare', 2000)]): GameState {
  const s = newGame(settings, timelines.map((_, i) => `P${i}`), [card('x', 1), card('y', 2), card('z', 3), card('w', 4)], 1);
  return {
    ...s,
    players: s.players.map((p, i) => ({ ...p, timeline: timelines[i] })),
    current,
    deck,
    discard: [],
  };
}

describe('placement', () => {
  const timeline = [card('a', 1969), card('b', 1982), card('c', 1997)];

  it('accepts the gap between neighbours', () => {
    expect(fitsAt(timeline, card('m', 1975), 1)).toBe(true);
    expect(fitsAt(timeline, card('m', 1975), 2)).toBe(false);
    expect(fitsAt(timeline, card('m', 1975), 0)).toBe(false);
  });

  it('lets equal years go on either side', () => {
    expect(correctSlots(timeline, card('m', 1982))).toEqual([1, 2]);
  });

  it('treats a ranged date as fitting anywhere inside its range', () => {
    expect(correctSlots(timeline, card('m', 1980, 1990))).toEqual([1, 2]);
  });

  it('checks every card, not just neighbours, when a ranged card sits on the timeline', () => {
    const t = [card('a', 1700), card('wide', 1650, 1720), card('c', 1710)];
    expect(fitsAt(t, card('m', 1715), 1)).toBe(false);
    expect(fitsAt(t, card('m', 1715), 3)).toBe(true);
  });

  it('auto-places by year', () => {
    expect(autoSlot(timeline, card('m', 1990))).toBe(2);
    expect(autoSlot(timeline, card('m', 1950))).toBe(0);
  });
});

describe('turns', () => {
  const mine = [card('a', 1969), card('b', 1982)];
  const theirs = [card('c', 2001)];

  it('keeps a correctly placed card and passes the turn', () => {
    const s = play(rigged([mine, theirs], card('m', 1975)), { type: 'selectSlot', slot: 1 }, { type: 'lockIn' }, { type: 'reveal' });
    expect(s.outcome?.placedCorrectly).toBe(true);
    const after = reduce(s, { type: 'next' });
    expect(after.players[0].timeline.map((c) => c.id)).toEqual(['a', 'm', 'b']);
    expect(after.turn).toBe(1);
    expect(after.phase).toBe('place');
  });

  it('lets the first correct challenger steal, and charges every challenger a chip', () => {
    let s = rigged([mine, theirs, [card('d', 1960)]], card('m', 1975));
    s = play(s, { type: 'selectSlot', slot: 0 }, { type: 'lockIn' });
    s = play(s, { type: 'startChallenge', playerId: 'p2' }, { type: 'selectSlot', slot: 2 }, { type: 'lockChallenge' });
    s = play(s, { type: 'startChallenge', playerId: 'p1' }, { type: 'selectSlot', slot: 1 }, { type: 'lockChallenge' });
    s = reduce(s, { type: 'reveal' });
    expect(s.outcome?.stealerId).toBe('p1');
    s = reduce(s, { type: 'next' });
    expect(s.players[1].timeline.map((c) => c.id)).toEqual(['m', 'c']);
    expect(s.players[1].chips).toBe(1);
    expect(s.players[2].chips).toBe(1);
    expect(s.players[0].timeline).toHaveLength(2);
  });

  it('refuses a challenge on a slot that is already taken', () => {
    let s = play(rigged([mine, theirs], card('m', 1975)), { type: 'selectSlot', slot: 1 }, { type: 'lockIn' });
    s = play(s, { type: 'startChallenge', playerId: 'p1' }, { type: 'selectSlot', slot: 1 });
    expect(s.picking?.slot).toBeNull();
  });

  it('awards a chip for naming both parts, capped at the maximum', () => {
    let s = rigged([mine, theirs], card('m', 1975));
    s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, chips: 5 } : p)) };
    s = play(s, { type: 'selectSlot', slot: 0 }, { type: 'lockIn' }, { type: 'reveal' });
    s = play(s, { type: 'toggleNamed', field: 'primary' }, { type: 'toggleNamed', field: 'secondary' }, { type: 'next' });
    expect(s.players[0].chips).toBe(5);
    expect(s.discard.map((c) => c.id)).toEqual(['m']);
  });

  it('pro variant only keeps the card when the answer was named', () => {
    let s = rigged([mine, theirs], card('m', 1975));
    s = { ...s, settings: { ...s.settings, variant: 'pro' } };
    s = play(s, { type: 'selectSlot', slot: 1 }, { type: 'lockIn' }, { type: 'reveal' }, { type: 'next' });
    expect(s.players[0].timeline).toHaveLength(2);
  });

  it('skipping costs a chip and draws a new card', () => {
    const s = reduce(rigged([mine, theirs], card('m', 1975)), { type: 'skip' });
    expect(s.players[0].chips).toBe(1);
    expect(s.current?.id).toBe('spare');
  });

  it('refuses skipping when the house rules leave it out', () => {
    let s = rigged([mine, theirs], card('m', 1975));
    s = { ...s, settings: { ...s.settings, allowSkip: false } };
    expect(reduce(s, { type: 'skip' })).toBe(s);
  });

  it('refuses buying a card unless the house rules allow it', () => {
    let s = rigged([mine, theirs], card('m', 1975), [card('n', 1990), card('o', 1991)]);
    s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, chips: 5 } : p)) };
    expect(reduce({ ...s, settings: { ...s.settings, allowBuy: false } }, { type: 'buyCard' }).players[0].chips).toBe(5);
    expect(reduce(s, { type: 'buyCard' }).players[0].chips).toBe(2);
  });

  it('reads a save without the newer house rules as buying off and skipping on', () => {
    const { allowBuy: _b, allowSkip: _s, ...old } = settings;
    let s = rigged([mine, theirs], card('m', 1975), [card('n', 1990), card('o', 1991)]);
    s = { ...s, settings: old as Settings, players: s.players.map((p, i) => (i === 0 ? { ...p, chips: 5 } : p)) };
    expect(reduce(s, { type: 'buyCard' })).toBe(s);
    expect(reduce(s, { type: 'skip' }).players[0].chips).toBe(4);
  });

  it('ends the game when someone reaches the target', () => {
    let s = rigged([mine, theirs], card('m', 1975));
    s = { ...s, settings: { ...s.settings, target: 3 } };
    s = play(s, { type: 'selectSlot', slot: 1 }, { type: 'lockIn' }, { type: 'reveal' }, { type: 'next' });
    expect(s.phase).toBe('over');
    expect(s.winnerId).toBe('p0');
  });
});
