import { newGame } from '../engine/game';
import type { Card, GameState, Settings } from '../engine/types';
import type { Member } from './protocol';

/** Deals a game to the room's members in join order; their room ids become the player ids. */
export function dealGame(settings: Settings, members: Member[], cards: Card[], seed: number): GameState {
  const s = newGame(
    settings,
    members.map((m) => m.name),
    cards,
    seed,
  );
  return { ...s, players: s.players.map((p, i) => ({ ...p, id: members[i].id })) };
}

/** A latecomer sits down last in the turn order with one face-up card and the starting chips. */
export function seatLatecomer(s: GameState, m: Member): GameState {
  if (s.phase === 'over' || s.players.some((p) => p.id === m.id)) return s;
  const [first, ...rest] = s.deck;
  return {
    ...s,
    deck: first ? rest : s.deck,
    players: [...s.players, { id: m.id, name: m.name, timeline: first ? [first] : [], chips: s.settings.startChips }],
  };
}

/** Two Lous at one table become Lou and Lou 2. */
export function uniqueName(name: string, members: Member[]): string {
  const taken = new Set(members.map((m) => m.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
}
