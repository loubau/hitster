import type { Settings } from '../engine/types';

const PREFS_KEY = 'hitster.prefs.v1';

export interface Prefs {
  names: string[];
  settings: Settings;
  /** Your own name, for rooms. */
  me: string;
}

const DEFAULTS: Prefs = {
  names: [],
  settings: {
    sets: ['regular'],
    target: 10,
    startChips: 2,
    maxChips: 5,
    variant: 'original',
    includeDutch: true,
    allowBuy: false,
    allowSkip: true,
  },
  me: '',
};

/** Names the setup used to prefill while testing; saved as-is they are not a real table. */
const TEST_NAMES = ['Sanne', 'Joost', 'Lou'];

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<Prefs>;
    // Settings merge field by field: rules added since the last visit take their defaults.
    const prefs = { ...DEFAULTS, ...saved, settings: { ...DEFAULTS.settings, ...saved.settings } };
    const leftover = prefs.names.length === TEST_NAMES.length && TEST_NAMES.every((n) => prefs.names.includes(n));
    return leftover ? { ...prefs, names: [] } : prefs;
  } catch {
    return DEFAULTS;
  }
}

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are a convenience only.
  }
}
