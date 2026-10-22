import type { Action } from '../engine/game';
import type { Card, GameState, Settings } from '../engine/types';

/* Room mode: every player on their own phone, all on one Supabase Realtime channel (room:<CODE>).
   The host's browser runs the reducer and broadcasts the whole room after every change; guests
   send intents and keep the latest copy, so any of them can carry on if the host disappears. */

export interface Member {
  id: string;
  name: string;
}

/** Everything a room agrees on. Only the host changes it. */
export interface Room {
  code: string;
  hostId: string;
  /** Bumped by every takeover, so a host that comes back after a failover sees it lost the room. */
  term: number;
  /** Bumped by the host on every change. */
  seq: number;
  /** Rules for the next game; a running game keeps its own copy in game.settings. */
  settings: Settings;
  /** In join order. The earliest one online takes over when the host is gone. */
  members: Member[];
  /** Ids the host removed; they are told so instead of being let back in. */
  removed: string[];
  /** Null while the room is in the lobby. */
  game: GameState | null;
  /** The last intent number the host handled per player, so guests can drop their predictions. */
  acks: Record<string, number>;
}

/**
 * The host's playback at one moment: expected position later is pos + (hostNow - at) / 1000.
 * Sent on every play, pause, seek and new card, and every few seconds while playing.
 */
export interface Tune {
  /** GameState.draw of the card it belongs to. */
  draw: number;
  videoId?: string;
  /** The clip's start offset ("id@37"), so a guest on another candidate can line up with it. */
  start: number;
  playing: boolean;
  /** Seconds into the video at `at`. */
  pos: number;
  /** Host clock, ms. */
  at: number;
}

/** Transport buttons pressed on a guest's phone; the host's player follows them and re-tunes. */
export type Control = { op: 'toggle' } | { op: 'restart' } | { op: 'seekBy'; by: number };

export type Msg =
  /** Sent on (re)connecting: asks the host for the room and joins it when `from` is new. */
  | { type: 'hello'; from: string; name: string }
  | { type: 'state'; room: WireRoom }
  | { type: 'intent'; from: string; to: string; n: number; action: Action }
  | { type: 'control'; from: string; to: string; control: Control }
  /** A guest leaving the lobby for good. */
  | { type: 'leave'; from: string }
  | { type: 'ping'; from: string; to: string; t0: number }
  | { type: 'pong'; from: string; to: string; t0: number; t1: number }
  | { type: 'tune'; from: string; tune: Tune };

/* On the wire the deck and discard pile are card ids: every device bundles the same cards, and the
   full deck would push a snapshot past Realtime's message size. Visible cards stay whole, so a
   phone on an older build still shows them. */
export type WireGame = Omit<GameState, 'deck' | 'discard'> & { deck: string[]; discard: string[] };
export type WireRoom = Omit<Room, 'game'> & { v: 1; game: WireGame | null };

export function encodeRoom(room: Room): WireRoom {
  const { game } = room;
  return {
    ...room,
    v: 1,
    game: game && { ...game, deck: game.deck.map((c) => c.id), discard: game.discard.map((c) => c.id) },
  };
}

/** Rebuilds a room; cards this build doesn't know are dropped from the deck. */
export function decodeRoom(wire: WireRoom, cardById: (id: string) => Card | undefined): Room {
  const { v: _v, game, ...rest } = wire;
  const cards = (ids: string[]) => ids.map(cardById).filter((c): c is Card => !!c);
  return { ...rest, game: game && { ...game, deck: cards(game.deck), discard: cards(game.discard) } };
}

/** Whether `a` supersedes `b`. Two hosts in the same term (a split) settle on the smaller id. */
export function isNewer(a: Pick<Room, 'term' | 'seq' | 'hostId'>, b: Pick<Room, 'term' | 'seq' | 'hostId'> | null): boolean {
  if (!b) return true;
  if (a.term !== b.term) return a.term > b.term;
  if (a.hostId !== b.hostId) return a.hostId < b.hostId;
  return a.seq > b.seq;
}

/** A plausible room off the wire or out of storage; anything else is ignored. */
export function isWireRoom(x: unknown): x is WireRoom {
  const r = x as WireRoom;
  return !!r && r.v === 1 && typeof r.code === 'string' && typeof r.hostId === 'string' && Array.isArray(r.members);
}
