/* Guests estimate the host's clock over ping/pong, NTP style: hostNow ≈ Date.now() + offset. */

export interface ClockSample {
  /** Host clock minus ours, ms. */
  offset: number;
  /** Round trip, ms. */
  rtt: number;
}

/** t0 = ping sent (ours), t1 = host's clock when it answered, t2 = pong received (ours). */
export function clockSample(t0: number, t1: number, t2: number): ClockSample {
  return { offset: t1 - (t0 + t2) / 2, rtt: t2 - t0 };
}

/** Median offset, so one pong stuck behind a slow message doesn't drag the estimate. */
export function estimateOffset(samples: ClockSample[]): number {
  if (samples.length === 0) return 0;
  const sorted = samples.map((s) => s.offset).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** How many samples to keep; older ones roll off as periodic pings come in. */
export const CLOCK_WINDOW = 9;
/** Pings sent right after joining or a host change. */
export const CLOCK_BURST = 5;
/** Pongs slower than this say more about the network than about the clock. */
export const CLOCK_MAX_RTT = 3000;

export class Clock {
  private samples: ClockSample[] = [];
  offset = 0;

  add(s: ClockSample) {
    if (s.rtt < 0 || s.rtt > CLOCK_MAX_RTT) return;
    this.samples = [...this.samples, s].slice(-CLOCK_WINDOW);
    this.offset = estimateOffset(this.samples);
  }

  reset() {
    this.samples = [];
    this.offset = 0;
  }

  get synced(): boolean {
    return this.samples.length > 0;
  }
}
