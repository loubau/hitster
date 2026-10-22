import type { GameState, Settings } from '../engine/types';

/** The challenge timer's one setting besides off. */
export const TIMER_SECONDS = 10;
/** When a challenger is done picking, the others still get at least this long. */
export const RESUME_MIN_MS = 3000;

/**
 * The challenge window for the card in play, in the host's clock: running until `ends`, or
 * standing still with `left` ms to go while a challenger picks a slot.
 */
export type ChallengeTimer = { draw: number; ends: number } | { draw: number; left: number };

export const timerMs = (s: Settings) => Math.max(0, s.challengeTimer ?? 0) * 1000;

/**
 * The window after a change to the game, at host time `now`. It opens at the lock-in, pauses while
 * someone picks and carries on with what was left (at least RESUME_MIN_MS) when they are done.
 */
export function nextTimer(game: GameState | null, timer: ChallengeTimer | null | undefined, now: number): ChallengeTimer | null {
  const ms = game ? timerMs(game.settings) : 0;
  if (!game || ms === 0 || game.phase !== 'challenge') return null;
  const { draw, picking } = game;
  if (!timer || timer.draw !== draw) return picking ? { draw, left: ms } : { draw, ends: now + ms };
  if (picking && 'ends' in timer) return { draw, left: Math.max(0, timer.ends - now) };
  if (!picking && 'left' in timer) return { draw, ends: now + Math.max(timer.left, RESUME_MIN_MS) };
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
