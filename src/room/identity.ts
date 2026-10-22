/** Who this device is in one room. */
export interface Identity {
  id: string;
  name: string;
  /** This device's sound. The room's opener starts unmuted, everyone else muted. */
  muted: boolean;
}

const key = (code: string) => `hitster.room.${code}`;
const LAST_KEY = 'hitster.room.last';

export function newPlayerId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

function parse(raw: string | null): Identity | null {
  try {
    const id = raw ? (JSON.parse(raw) as Identity) : null;
    return id && typeof id.id === 'string' && typeof id.name === 'string' ? { ...id, muted: !!id.muted } : null;
  } catch {
    return null;
  }
}

/*
 * sessionStorage first, so two tabs of one browser can be two players while testing; localStorage
 * second, so reopening the link in a new tab (or after the phone dropped the tab) rejoins as the
 * same player. claimIdentity keeps a second tab from taking over the first one's player.
 */
export function loadIdentity(code: string): Identity | null {
  const read = (s: () => Storage) => {
    try {
      return parse(s().getItem(key(code)));
    } catch {
      return null;
    }
  };
  return read(() => sessionStorage) ?? read(() => localStorage);
}

export function saveIdentity(code: string, identity: Identity) {
  const raw = JSON.stringify(identity);
  for (const s of [() => sessionStorage, () => localStorage]) {
    try {
      s().setItem(key(code), raw);
    } catch {
      // Unavailable (private mode): the player just has to type their name again after a reload.
    }
  }
  try {
    localStorage.setItem(LAST_KEY, code);
  } catch {
    // As above.
  }
}

export function forgetIdentity(code: string) {
  for (const s of [() => sessionStorage, () => localStorage]) {
    try {
      s().removeItem(key(code));
    } catch {
      // Nothing to forget.
    }
  }
  try {
    if (localStorage.getItem(LAST_KEY) === code) localStorage.removeItem(LAST_KEY);
  } catch {
    // As above.
  }
}

/** The room this browser was last in, while it still has an identity there. */
export function lastRoom(): string | null {
  try {
    const code = localStorage.getItem(LAST_KEY);
    return code && loadIdentity(code) ? code : null;
  } catch {
    return null;
  }
}

/** Claims this tab holds, so asking twice (React's dev double-mount, leaving and coming back) is safe. */
const held = new Map<string, Promise<(() => void) | null>>();

/**
 * Holds a Web Lock on the player for as long as this tab is in the room. Resolves to a release
 * function, or null when another tab of this browser is already that player. Browsers without
 * Web Locks always get the player.
 */
export function claimIdentity(code: string, id: string): Promise<(() => void) | null> {
  const name = `hitster.room.${code}.${id}`;
  const existing = held.get(name);
  if (existing) return existing;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  const claim = new Promise<(() => void) | null>((resolve) => {
    if (!locks) return resolve(() => {});
    void locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (!lock) return resolve(null);
        return new Promise<void>((release) => resolve(release));
      })
      .catch(() => resolve(() => {}));
  }).then((release) => {
    if (!release) {
      held.delete(name);
      return null;
    }
    return () => {
      held.delete(name);
      release();
    };
  });
  held.set(name, claim);
  return claim;
}

export interface Seat {
  identity: Identity;
  /** Gives the player up to other tabs of this browser. */
  release: () => void;
}

/**
 * This tab's player in a room: the one this browser already has there (unless another tab is
 * playing it), or a new one under `name`. Null when there is no player to take and no name yet.
 * Whoever opens the room hears the music; everyone else starts muted.
 */
export async function takeSeat(code: string, name: string | null, opener = false): Promise<Seat | null> {
  const known = loadIdentity(code);
  if (known) {
    const release = await claimIdentity(code, known.id);
    if (release) {
      saveIdentity(code, known);
      return { identity: known, release };
    }
  }
  if (!name) return null;
  const identity: Identity = { id: newPlayerId(), name, muted: !opener };
  const release = (await claimIdentity(code, identity.id)) ?? (() => {});
  saveIdentity(code, identity);
  return { identity, release };
}
