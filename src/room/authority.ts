import { activePlayer, buyAllowed, challengers, skipAllowed, type Action } from '../engine/game';
import type { GameState } from '../engine/types';
import type { Member } from './protocol';

/** Who is asking, and what the room looks like to the host deciding. */
export interface Asker {
  playerId: string;
  hostId: string;
  /** Members online right now (presence). */
  online: ReadonlySet<string>;
  /** False once the challenge timer has run out; left out, challenges stay open. */
  challengesOpen?: boolean;
}

/**
 * Whether this player may take this action now; the reducer still decides whether it does anything.
 * The host may stand in for a player whose phone has gone, so the table never waits on a dead
 * battery.
 */
export function mayAct(s: GameState, a: Action, who: Asker): boolean {
  const me = who.playerId;
  const isHost = me === who.hostId;
  const active = activePlayer(s).id;
  const as = (id: string) => me === id || (isHost && !who.online.has(id));
  switch (a.type) {
    case 'selectSlot':
      if (s.phase === 'place') return as(active);
      return s.phase === 'challenge' && !!s.picking && as(s.picking.playerId);
    case 'lockIn':
      return s.phase === 'place' && as(active);
    case 'skip':
      return s.phase === 'place' && skipAllowed(s.settings) && as(active);
    case 'buyCard':
      return s.phase === 'place' && buyAllowed(s.settings) && as(active);
    case 'startChallenge':
      // Only for yourself; when two tap at once, the host takes whichever intent arrives first.
      if (who.challengesOpen === false) return false;
      return a.playerId === me && s.phase === 'challenge' && !s.picking && challengers(s).some((p) => p.id === me);
    case 'pass':
      // Only for yourself, and only while you could still have challenged.
      if (who.challengesOpen === false) return false;
      return a.playerId === me && s.phase === 'challenge' && s.picking?.playerId !== me && challengers(s).some((p) => p.id === me);
    case 'cancelChallenge':
      return !!s.picking && (s.picking.playerId === me || isHost);
    case 'lockChallenge':
      return !!s.picking && as(s.picking.playerId);
    case 'reveal':
      return s.phase === 'challenge' && (me === active || isHost);
    case 'toggleNamed':
    case 'next':
      return s.phase === 'reveal' && (me === active || isHost);
    case 'updateSettings':
      return isHost;
  }
}

/** Play, pause and seek: whoever is placing, and the host. */
export function mayControl(s: GameState | null, who: Asker): boolean {
  return who.playerId === who.hostId || (!!s && s.phase !== 'over' && activePlayer(s).id === who.playerId);
}

/** How long the host may be missing from presence before someone takes over. */
export const HOST_GRACE_MS = 10_000;

/** The earliest-joined member who is online, leaving out the host that went missing. */
export function electHost(members: Member[], online: ReadonlySet<string>, goneId: string): string | null {
  return members.find((m) => m.id !== goneId && online.has(m.id))?.id ?? null;
}
