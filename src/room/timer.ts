import { challengers } from '../engine/game';
import type { GameState, Settings } from '../engine/types';

/** The challenge timer unless the host set another: new rooms, and older rooms and saves without one. */
export const TIMER_SECONDS = 10;
/** When a challenger is done picking, the others still get at least this long. */
export const RESUME_MIN_MS = 3000;
/** With nobody left who could challenge, the card turns over after this beat. */
export const BEAT_MS = 1000;

/**
 * The challenge window for the card in play, in the host's clock: running until `ends`, or
 * standing still with `left` ms to go while a challenger picks a slot. `settled`: nobody is left
 * to challenge, so `ends` is only a beat away.
 */
export type ChallengeTimer = { draw: number; ends: number; settled?: boolean } | { draw: number; left: number };

export const timerSeconds = (s: Settings) => (s.challengeTimer && s.challengeTimer > 0 ? s.challengeTimer : TIMER_SECONDS);
export const timerMs = (s: Settings) => timerSeconds(s) * 1000;

/**
 * The window after a change to the game, at host time `now`. It opens at the lock-in, pauses while
 * someone picks and carries on with what was left (at least RESUME_MIN_MS) when they are done.
 * Each time it (re)starts or someone passes, `online` (presence, when known) is checked: with
 * nobody there who could still challenge, it closes after a beat instead.
 */
export function nextTimer(
  game: GameState | null,
  timer: ChallengeTimer | null | undefined,
  now: number,
  online?: ReadonlySet<string>,
): ChallengeTimer | null {
  if (!game || game.phase !== 'challenge') return null;
  const ms = timerMs(game.settings);
  const { draw, picking } = game;
  const nobodyLeft = !!online && !challengers(game).some((p) => online.has(p.id));
  const run = (ends: number): ChallengeTimer => (nobodyLeft ? { draw, ends: Math.min(ends, now + BEAT_MS), settled: true } : { draw, ends });
  if (!timer || timer.draw !== draw) return picking ? { draw, left: ms } : run(now + ms);
  if (picking && 'ends' in timer) return { draw, left: Math.max(0, timer.ends - now) };
  if (!picking && 'left' in timer) return run(now + Math.max(timer.left, RESUME_MIN_MS));
  // The last one who could have challenged passed.
  if ('ends' in timer && !picking && !timer.settled && nobodyLeft) return run(timer.ends);
  return timer;
}

/** Ms left at host time `now`. */
export const timeLeft = (timer: ChallengeTimer, now: number) => ('ends' in timer ? Math.max(0, timer.ends - now) : timer.left);

/** Whether a challenge may still start: no timer, or it has not run out. */
export const challengesOpen = (timer: ChallengeTimer | null | undefined, now: number) => !timer || !('ends' in timer) || now < timer.ends;

/** The host's cue to turn the card over: time is up and nobody is picking. */
export function timeUp(game: GameState | null, timer: ChallengeTimer | null | undefined, now: number): boolean {
  return !!game && !!timer && 'ends' in timer && timer.draw === game.draw && game.phase === 'challenge' && !game.picking && now >= timer.ends;
}
