import type { Tune } from './protocol';

/** Guests correct when they are further off than this, in seconds. */
export const DRIFT_LIMIT = 0.35;
/** How often a guest checks its drift, and how often a playing host re-sends its tune. */
export const DRIFT_CHECK_MS = 5000;

/** Where the host's video is at host time `hostNow`, in seconds. */
export function hostPosition(t: Tune, hostNow: number): number {
  return t.playing ? t.pos + Math.max(0, hostNow - t.at) / 1000 : t.pos;
}

/** The slice of a guest's own player that following needs. */
export interface Local {
  playing: boolean;
  /** Seconds into this device's video. */
  time: number;
  videoId?: string;
  /** This device's clip start offset. */
  start: number;
}

/**
 * Where this device should be: the host's spot in the same video, or, on a backup candidate after
 * the host's video failed here, as far past its own start as the host is past the host's.
 */
export function targetPosition(t: Tune, hostNow: number, local: Pick<Local, 'videoId' | 'start'>): number {
  const pos = hostPosition(t, hostNow);
  return local.videoId === t.videoId ? pos : local.start + Math.max(0, pos - t.start);
}

export interface Step {
  seek?: number;
  play?: true;
  pause?: true;
}

/** What a guest's player must do to match the host's tune now. */
export function syncStep(local: Local, t: Tune, hostNow: number, limit = DRIFT_LIMIT): Step {
  const target = targetPosition(t, hostNow, local);
  const step: Step = Math.abs(local.time - target) > limit ? { seek: target } : {};
  if (t.playing && !local.playing) step.play = true;
  if (!t.playing && local.playing) step.pause = true;
  return step;
}
