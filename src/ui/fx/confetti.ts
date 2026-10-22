import confetti from 'canvas-confetti';
import type { SetId } from '../../engine/types';

const NEON = ['#ff4f9a', '#ffe14d', '#2ec5ff', '#5ee6a8', '#ff8a3d', '#ffffff'];

let shapes: { notes: confetti.Shape[]; petal: confetti.Shape } | null = null;

// Text/path shapes need a canvas, so build them on first use rather than at import time.
function themedShapes() {
  if (!shapes) {
    const notes = ['♪', '♫', '♩', '♬'].flatMap((text) => [
      confetti.shapeFromText({ text, scalar: 2.4, color: '#e2b25a' }),
      confetti.shapeFromText({ text, scalar: 2.4, color: '#f3e9d2' }),
    ]);
    const petal = confetti.shapeFromPath({ path: 'M0 7 C 4 -1, 12 -1, 16 7 C 12 15, 4 15, 0 7 Z' });
    shapes = { notes, petal };
  }
  return shapes;
}

export function burst(set: SetId, big = false): void {
  const base: confetti.Options = {
    particleCount: big ? 170 : 110,
    spread: big ? 110 : 80,
    startVelocity: big ? 55 : 46,
    origin: { y: 0.38 },
    zIndex: 80,
    disableForReducedMotion: true,
  };
  if (set === 'regular') {
    confetti({ ...base, colors: NEON, shapes: ['square', 'circle', 'star'], scalar: 1.15 });
    confetti({ ...base, particleCount: 40, angle: 60, origin: { x: 0, y: 0.7 }, colors: NEON });
    confetti({ ...base, particleCount: 40, angle: 120, origin: { x: 1, y: 0.7 }, colors: NEON });
  } else if (set === 'jazz') {
    confetti({ ...base, shapes: themedShapes().notes, scalar: 2.2, gravity: 0.55, drift: 0.3, ticks: 260, flat: true });
    confetti({ ...base, particleCount: 50, colors: ['#d9a84e', '#f3e9d2'], shapes: ['circle'], scalar: 0.8 });
  } else {
    confetti({
      ...base,
      shapes: [themedShapes().petal],
      colors: ['#b3122e', '#e0475f', '#f6efdf', '#d8b45a', '#8e1f33'],
      scalar: 1.7,
      gravity: 0.45,
      drift: 0.5,
      ticks: 340,
      startVelocity: 38,
    });
  }
}

/** A few staggered bursts for the end of the game. */
export function fireworks(set: SetId): () => void {
  const timers = [0, 650, 1300, 2100].map((ms, i) =>
    setTimeout(() => {
      burst(set, true);
      if (set === 'regular' && i % 2) confetti({ particleCount: 80, spread: 360, startVelocity: 30, origin: { y: 0.3 }, colors: NEON, zIndex: 80 });
    }, ms),
  );
  return () => timers.forEach(clearTimeout);
}
