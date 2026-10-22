import type { Card, Fact, SetId, Settings } from '../engine/types';

/* Raw shapes written by the curation agents (see data/sets/<set>/part-*.json). */
interface RawCommon {
  id: string;
  year: number;
  year_lo?: number;
  year_hi?: number;
  year_label?: string;
  trivia?: string;
  tags?: string[];
  region?: string;
}
interface RawRegular extends RawCommon {
  artist: string;
  title: string;
}
interface RawJazz extends RawRegular {
  composer?: string;
  recording_date?: string | null;
  recording_year?: number;
  release_year?: number;
  original_issue?: string;
  personnel?: string;
}
interface RawClassical extends RawCommon {
  composer: string;
  composer_short?: string;
  work: string;
  nickname?: string | null;
  form?: string;
  accept_work?: string;
  excerpt?: string;
  premiere_or_publication?: string;
  recording?: { performers?: string | null; conductor?: string | null; label?: string | null; year?: number | null };
}

const files = import.meta.glob('/data/sets/*/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

const facts = (pairs: [string, string | null | undefined][]): Fact[] =>
  pairs.filter((p): p is [string, string] => !!p[1]).map(([label, value]) => ({ label, value }));

function base(raw: RawCommon, set: SetId) {
  const yearLo = raw.year_lo ?? raw.year;
  const yearHi = raw.year_hi ?? raw.year;
  return {
    id: raw.id,
    set,
    year: raw.year,
    yearLo: Math.min(yearLo, yearHi),
    yearHi: Math.max(yearLo, yearHi),
    yearLabel: raw.year_label ?? String(raw.year),
    trivia: raw.trivia ?? '',
    region: raw.region ?? 'intl',
    tags: raw.tags ?? [],
  };
}

function normalise(raw: unknown, set: SetId): Card | null {
  const r = raw as RawCommon;
  if (!r || typeof r.id !== 'string' || typeof r.year !== 'number') return null;
  if (set === 'classical') {
    const c = raw as RawClassical;
    const rec = c.recording;
    const screen = { film: 'Film', tv: 'Series', game: 'Game' }[c.form ?? ''];
    return {
      ...base(c, set),
      primary: c.composer,
      secondary: c.work,
      primaryLabel: 'Composer',
      secondaryLabel: screen ?? 'Work',
      excerpt: c.excerpt,
      accept: c.accept_work,
      facts: facts([
        ['Recording', rec && [rec.conductor, rec.performers, rec.year].filter(Boolean).join(', ')],
        ['First heard', c.premiere_or_publication],
      ]),
    };
  }
  const p = raw as RawJazz;
  const card: Card = {
    ...base(p, set),
    primary: p.artist,
    secondary: p.title,
    primaryLabel: 'Artist',
    secondaryLabel: 'Title',
    facts: [],
  };
  if (set === 'jazz') {
    // Card year is the recording year; the first release goes in brackets when it differs.
    if (p.release_year && p.release_year !== card.year) card.yearNote = `(${p.release_year})`;
    card.facts = facts([
      ['Composer', p.composer],
      ['Recorded', p.recording_date],
      ['Band', p.personnel],
      ['First issue', p.original_issue],
    ]);
  }
  return card;
}

function load(): Card[] {
  const byId = new Map<string, Card>();
  for (const [path, content] of Object.entries(files)) {
    const set = path.split('/')[3] as SetId;
    if (!Array.isArray(content)) continue;
    for (const raw of content) {
      const card = normalise(raw, set);
      if (card && !byId.has(card.id)) byId.set(card.id, card);
    }
  }
  return [...byId.values()];
}

export const ALL_CARDS = load();

export const SET_INFO: Record<SetId, { name: string; blurb: string }> = {
  regular: { name: 'Regular', blurb: 'Pop hits, Elvis to Eilish' },
  jazz: { name: 'Jazz', blurb: 'Landmark recordings, Ellington to Esperanza Spalding' },
  classical: { name: 'Classical', blurb: 'Composer and year written' },
};

export function cardsFor(settings: Pick<Settings, 'sets' | 'includeDutch'>): Card[] {
  return ALL_CARDS.filter(
    (c) => settings.sets.includes(c.set) && (settings.includeDutch || (c.region !== 'nl' && c.region !== 'be')),
  );
}

export function countBySet(): Record<SetId, number> {
  const counts: Record<SetId, number> = { regular: 0, jazz: 0, classical: 0 };
  for (const c of ALL_CARDS) counts[c.set]++;
  return counts;
}
