import { useEffect, useState } from 'react';
import { timeLeft, type ChallengeTimer } from '../room/timer';

/** The clock stays quiet until this close to the end. */
const URGENT_MS = 3000;
const FRAME_MS = 100;

/** Whether the challenge window has run out, by this device's view of the host clock. */
export function useTimeUp(timer: ChallengeTimer | null, hostNow: () => number): boolean {
  const [up, setUp] = useState(false);
  const ends = timer && 'ends' in timer ? timer.ends : null;
  useEffect(() => {
    setUp(false);
    if (ends === null) return;
    const ms = ends - hostNow();
    if (ms <= 0) return void setUp(true);
    const t = setTimeout(() => setUp(true), ms);
    return () => clearTimeout(t);
    // hostNow only reads the client's clock.
  }, [ends]);
  return up;
}

/** A bar along the top of the footer, on every phone: drains calmly, then counts down the last seconds. */
export function ChallengeClock({ timer, total, hostNow }: { timer: ChallengeTimer; total: number; hostNow: () => number }) {
  const [, frame] = useState(0);
  const running = 'ends' in timer;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => frame((n) => n + 1), FRAME_MS);
    return () => clearInterval(t);
  }, [running]);

  const left = timeLeft(timer, hostNow());
  const secs = Math.ceil(left / 1000);
  const urgent = running && left > 0 && left <= URGENT_MS;
  return (
    <div
      className={`challenge-clock${urgent ? ' is-urgent' : ''}${running ? '' : ' is-paused'}`}
      role="timer"
      aria-label={running ? `${secs} seconds left to challenge` : 'Challenge timer paused'}
    >
      <i style={{ transform: `scaleX(${total > 0 ? Math.min(1, left / total) : 0})` }} />
      {urgent && <b key={secs}>{secs}</b>}
    </div>
  );
}
