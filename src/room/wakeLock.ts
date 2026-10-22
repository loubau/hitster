import { useEffect } from 'react';

/** Keeps the screen on while `on`, where the browser supports it; re-taken when the tab comes back. */
export function useWakeLock(on: boolean) {
  useEffect(() => {
    const wake = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
    if (!on || !wake) return;
    let lock: WakeLockSentinel | null = null;
    let done = false;
    const take = () => {
      if (done || document.visibilityState !== 'visible') return;
      wake
        .request('screen')
        .then((l) => {
          if (done) void l.release();
          else lock = l;
        })
        .catch(() => {
          // Refused (battery saver, no permission): the screen just dims as usual.
        });
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      done = true;
      document.removeEventListener('visibilitychange', take);
      void lock?.release().catch(() => {});
    };
  }, [on]);
}
