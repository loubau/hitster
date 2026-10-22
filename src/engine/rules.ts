import type { Card, Challenge, ChallengeResult, Named, Outcome, Variant } from './types';

/**
 * A card fits a slot when no card before it is definitely later and no card after it is
 * definitely earlier. Checking every card (not just the neighbours) matters once ranged
 * classical dates are on the timeline. Equal years fit on either side.
 */
export function fitsAt(timeline: Card[], card: Card, slot: number): boolean {
  for (let i = 0; i < timeline.length; i++) {
    const other = timeline[i];
    if (i < slot && other.yearLo > card.yearHi) return false;
    if (i >= slot && other.yearHi < card.yearLo) return false;
  }
  return true;
}

export function correctSlots(timeline: Card[], card: Card): number[] {
  const slots: number[] = [];
  for (let s = 0; s <= timeline.length; s++) if (fitsAt(timeline, card, s)) slots.push(s);
  return slots;
}

/** Where a card lands when it's placed for a player (steals, bought cards, starting cards). */
export function autoSlot(timeline: Card[], card: Card): number {
  const byYear = timeline.filter((c) => c.year <= card.year).length;
  if (fitsAt(timeline, card, byYear)) return byYear;
  return correctSlots(timeline, card)[0] ?? byYear;
}

export function insertAt(timeline: Card[], card: Card, slot: number): Card[] {
  return [...timeline.slice(0, slot), card, ...timeline.slice(slot)];
}

export function judge(timeline: Card[], card: Card, slot: number, challenges: Challenge[]): Outcome {
  const results: ChallengeResult[] = challenges.map((c) => ({ ...c, correct: fitsAt(timeline, card, c.slot) }));
  const placedCorrectly = fitsAt(timeline, card, slot);
  return {
    placedCorrectly,
    correctSlots: correctSlots(timeline, card),
    challenges: results,
    stealerId: results.find((r) => r.correct)?.playerId ?? null,
  };
}

/** Pro needs the answer named to keep the card; Expert also needs the exact year. */
export function keepsCard(variant: Variant, outcome: Outcome, named: Named): boolean {
  if (!outcome.placedCorrectly) return false;
  if (variant === 'original') return true;
  const answer = named.primary && named.secondary;
  return variant === 'pro' ? answer : answer && named.year;
}

export function earnsChip(named: Named): boolean {
  return named.primary && named.secondary;
}
