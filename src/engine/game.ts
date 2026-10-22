import { autoSlot, earnsChip, insertAt, judge, keepsCard } from './rules';
import { shuffle } from './rng';
import type { Card, GameState, Named, Player, Settings } from './types';

export const SKIP_COST = 1;
export const CHALLENGE_COST = 1;
export const BUY_COST = 3;

export type Action =
  | { type: 'selectSlot'; slot: number }
  | { type: 'lockIn' }
  | { type: 'skip' }
  | { type: 'buyCard' }
  | { type: 'startChallenge'; playerId: string }
  /** Room: this player won't challenge this card. */
  | { type: 'pass'; playerId: string }
  | { type: 'cancelChallenge' }
  | { type: 'lockChallenge' }
  | { type: 'reveal' }
  | { type: 'toggleNamed'; field: keyof Named }
  | { type: 'next' }
  /** New rules from the next card. `cards`: every card the new sets hold, for a new deck when they change. */
  | { type: 'updateSettings'; settings: Settings; cards?: Card[] };

const NOTHING_NAMED: Named = { primary: false, secondary: false, year: false };

/* Saves and room snapshots from before these house rules lack them: read them with their defaults. */
export const buyAllowed = (settings: Settings) => settings.allowBuy === true;
export const skipAllowed = (settings: Settings) => settings.allowSkip !== false;

export function newGame(settings: Settings, names: string[], cards: Card[], seed: number): GameState {
  let deck = shuffle(cards, seed);
  // Everyone starts with one face-up card, as in the physical game.
  const players: Player[] = names.map((name, i) => {
    const [first, ...rest] = deck;
    deck = rest;
    return { id: `p${i}`, name, timeline: first ? [first] : [], chips: settings.startChips };
  });
  const [current, ...rest] = deck;
  return {
    settings,
    players,
    turn: 0,
    deck: rest,
    discard: [],
    current: current ?? null,
    phase: current ? 'place' : 'over',
    slot: null,
    challenges: [],
    picking: null,
    outcome: null,
    named: NOTHING_NAMED,
    winnerId: null,
    seed,
    draw: 1,
  };
}

export const activePlayer = (s: GameState): Player => s.players[s.turn];

/** Players who may still challenge this turn. */
export function challengers(s: GameState): Player[] {
  const active = activePlayer(s);
  const passed = s.passed ?? [];
  return s.players.filter(
    (p) =>
      p.id !== active.id && p.chips >= CHALLENGE_COST && !s.challenges.some((c) => c.playerId === p.id) && !passed.includes(p.id),
  );
}

/** The fewest cards to win a game in progress: one more than anyone already has. */
export const minTarget = (s: GameState) => Math.max(0, ...s.players.map((p) => p.timeline.length)) + 1;

/** Cards from `pool` that are in nobody's timeline, not in the discard pile and not playing now. */
export function unusedCards(s: GameState, pool: Card[]): Card[] {
  const used = new Set([...s.players.flatMap((p) => p.timeline), ...s.discard, ...(s.current ? [s.current] : [])].map((c) => c.id));
  return pool.filter((c) => !used.has(c.id));
}

/** Whether two sets of rules deal from the same cards. */
export const sameCards = (a: Settings, b: Settings) =>
  a.includeDutch === b.includeDutch && a.sets.length === b.sets.length && a.sets.every((id) => b.sets.includes(id));

/** Rules from mid-game take over: nobody wins by the change, and nobody keeps chips above the new cap. */
function applyNextSettings(s: GameState): GameState {
  if (!s.nextSettings) return s;
  const settings = { ...s.nextSettings, target: Math.max(s.nextSettings.target, minTarget(s)) };
  const players = s.players.map((p) => (p.chips > settings.maxChips ? { ...p, chips: settings.maxChips } : p));
  return { ...s, settings, players, nextSettings: null };
}

/** Slots already claimed this turn (by the active player or an earlier challenger). */
export function takenSlots(s: GameState): number[] {
  return [...(s.slot === null ? [] : [s.slot]), ...s.challenges.map((c) => c.slot)];
}

function updatePlayer(s: GameState, id: string, fn: (p: Player) => Player): Player[] {
  return s.players.map((p) => (p.id === id ? fn(p) : p));
}

/** Takes the next mystery card, reshuffling the discard pile when the deck runs out. */
function drawCard(s: GameState): GameState {
  let { deck, discard } = s;
  if (deck.length === 0 && discard.length > 0) {
    deck = shuffle(discard, s.seed + s.draw);
    discard = [];
  }
  const [current, ...rest] = deck;
  const base = { ...s, deck: rest, discard, current: current ?? null, draw: s.draw + 1 };
  return current ? base : { ...base, phase: 'over', winnerId: leader(s).id };
}

function leader(s: GameState): Player {
  return s.players.reduce((best, p) => (p.timeline.length > best.timeline.length ? p : best));
}

function resetTurn(s: GameState): GameState {
  return { ...s, phase: 'place', slot: null, challenges: [], picking: null, passed: [], outcome: null, named: NOTHING_NAMED };
}

export function reduce(s: GameState, a: Action): GameState {
  const active = activePlayer(s);
  switch (a.type) {
    case 'selectSlot': {
      if (s.phase === 'place') return { ...s, slot: a.slot };
      if (s.phase === 'challenge' && s.picking && !takenSlots(s).includes(a.slot)) {
        return { ...s, picking: { ...s.picking, slot: a.slot } };
      }
      return s;
    }
    case 'lockIn':
      return s.phase === 'place' && s.slot !== null ? { ...s, phase: 'challenge' } : s;

    case 'skip': {
      if (s.phase !== 'place' || !s.current || active.chips < SKIP_COST || !skipAllowed(s.settings)) return s;
      const players = updatePlayer(s, active.id, (p) => ({ ...p, chips: p.chips - SKIP_COST }));
      return drawCard(applyNextSettings({ ...s, players, slot: null, discard: [...s.discard, s.current] }));
    }
    case 'buyCard': {
      if (s.phase !== 'place' || active.chips < BUY_COST || s.deck.length === 0 || !buyAllowed(s.settings)) return s;
      const [bought, ...deck] = s.deck;
      const players = updatePlayer(s, active.id, (p) => ({
        ...p,
        chips: p.chips - BUY_COST,
        timeline: insertAt(p.timeline, bought, autoSlot(p.timeline, bought)),
      }));
      const next = { ...s, players, deck, slot: null };
      const buyer = players.find((p) => p.id === active.id)!;
      return buyer.timeline.length >= s.settings.target ? { ...next, phase: 'over', winnerId: buyer.id } : next;
    }
    case 'startChallenge': {
      if (s.phase !== 'challenge' || s.picking) return s;
      if (!challengers(s).some((p) => p.id === a.playerId)) return s;
      return { ...s, picking: { playerId: a.playerId, slot: null } };
    }
    case 'pass': {
      if (s.phase !== 'challenge' || s.picking?.playerId === a.playerId) return s;
      if (!challengers(s).some((p) => p.id === a.playerId)) return s;
      return { ...s, passed: [...(s.passed ?? []), a.playerId] };
    }
    case 'cancelChallenge':
      return { ...s, picking: null };

    case 'lockChallenge': {
      if (!s.picking || s.picking.slot === null) return s;
      const { playerId, slot } = s.picking;
      const players = updatePlayer(s, playerId, (p) => ({ ...p, chips: p.chips - CHALLENGE_COST }));
      return { ...s, players, challenges: [...s.challenges, { playerId, slot }], picking: null };
    }
    case 'reveal': {
      if (s.phase !== 'challenge' || s.picking || !s.current || s.slot === null) return s;
      return { ...s, phase: 'reveal', outcome: judge(active.timeline, s.current, s.slot, s.challenges) };
    }
    case 'toggleNamed':
      return s.phase === 'reveal' ? { ...s, named: { ...s.named, [a.field]: !s.named[a.field] } } : s;

    case 'next': {
      if (s.phase !== 'reveal' || !s.outcome || !s.current || s.slot === null) return s;
      const card = s.current;
      const keep = keepsCard(s.settings.variant, s.outcome, s.named);
      const stealer = keep ? null : s.outcome.stealerId;
      let players = s.players;
      let discard = s.discard;
      if (keep) {
        const slot = s.slot;
        players = updatePlayer(s, active.id, (p) => ({ ...p, timeline: insertAt(p.timeline, card, slot) }));
      } else if (stealer) {
        players = updatePlayer({ ...s, players }, stealer, (p) => ({
          ...p,
          timeline: insertAt(p.timeline, card, autoSlot(p.timeline, card)),
        }));
      } else {
        discard = [...discard, card];
      }
      if (earnsChip(s.named)) {
        players = updatePlayer({ ...s, players }, active.id, (p) => ({
          ...p,
          chips: Math.min(s.settings.maxChips, p.chips + 1),
        }));
      }
      const winner =
        players.find((p) => p.id === active.id && p.timeline.length >= s.settings.target) ??
        players.find((p) => p.timeline.length >= s.settings.target);
      const after = { ...s, players, discard };
      if (winner) return { ...after, phase: 'over', winnerId: winner.id };
      return drawCard(resetTurn(applyNextSettings({ ...after, turn: (s.turn + 1) % s.players.length })));
    }
    case 'updateSettings': {
      const { settings } = a;
      if (s.phase === 'over' || settings.sets.length === 0 || settings.maxChips < 1) return s;
      const next: Settings = {
        ...settings,
        target: Math.max(settings.target, minTarget(s)),
        startChips: Math.min(settings.startChips, settings.maxChips),
      };
      let deck = s.deck;
      if (!sameCards(s.nextSettings ?? s.settings, next)) {
        // The cards still to come, from the new sets; the ones already out stay where they are.
        const fresh = a.cards ? unusedCards(s, a.cards) : [];
        if (fresh.length === 0) return s;
        deck = shuffle(fresh, s.seed + s.draw * 31);
      }
      return { ...s, deck, nextSettings: next };
    }
  }
}
