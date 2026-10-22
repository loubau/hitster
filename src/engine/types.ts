export type SetId = 'regular' | 'jazz' | 'classical';

export interface Fact {
  label: string;
  value: string;
}

/** A card normalised from any of the three curated sets. */
export interface Card {
  id: string;
  set: SetId;
  /** Best single estimate; used to order auto-placed cards. */
  year: number;
  /** Placement accepts any year in [yearLo, yearHi] (classical dates can be ranges). */
  yearLo: number;
  yearHi: number;
  /** Printed big on the card: "1975", "c. 1680–1706". */
  yearLabel: string;
  /** Printed small next to the year, e.g. a jazz release year "(1959)". */
  yearNote?: string;
  /** Artist (regular, jazz) or composer (classical). */
  primary: string;
  /** Title (regular, jazz) or work (classical). */
  secondary: string;
  primaryLabel: string;
  secondaryLabel: string;
  /** Classical: the movement that plays. */
  excerpt?: string;
  /** Classical: what counts as naming the work. */
  accept?: string;
  trivia: string;
  facts: Fact[];
  region: string;
  tags: string[];
}

export type Variant = 'original' | 'pro' | 'expert';

export interface Settings {
  sets: SetId[];
  target: number;
  startChips: number;
  maxChips: number;
  variant: Variant;
  includeDutch: boolean;
  /** House rule: spend 3 chips for a card. Off by default; missing in older saves means off. */
  allowBuy: boolean;
  /** House rule: spend 1 chip to skip a song. On by default; missing in older saves means on. */
  allowSkip: boolean;
  /**
   * Rooms only: seconds to challenge after a lock-in, then the card is revealed. 0 is no timer,
   * and so is a missing field (rooms from before the rule). The table ignores it.
   */
  challengeTimer?: number;
}

export interface Player {
  id: string;
  name: string;
  timeline: Card[];
  chips: number;
}

export interface Challenge {
  playerId: string;
  slot: number;
}

export interface ChallengeResult extends Challenge {
  correct: boolean;
}

export interface Outcome {
  placedCorrectly: boolean;
  correctSlots: number[];
  challenges: ChallengeResult[];
  /** First challenger who placed it correctly, when the active player did not keep it. */
  stealerId: string | null;
}

export interface Named {
  primary: boolean;
  secondary: boolean;
  year: boolean;
}

export type Phase = 'place' | 'challenge' | 'reveal' | 'over';

export interface GameState {
  settings: Settings;
  players: Player[];
  turn: number;
  deck: Card[];
  discard: Card[];
  current: Card | null;
  phase: Phase;
  /** Active player's chosen slot (0 = before the first card). */
  slot: number | null;
  challenges: Challenge[];
  /** A challenger currently choosing their slot. */
  picking: { playerId: string; slot: number | null } | null;
  outcome: Outcome | null;
  named: Named;
  winnerId: string | null;
  seed: number;
  /** Bumps on every new mystery card so the UI can restart playback/animations. */
  draw: number;
}
