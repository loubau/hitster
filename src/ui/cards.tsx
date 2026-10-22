import type { CSSProperties } from 'react';
import type { Card, SetId } from '../engine/types';
import { Icon } from './Icon';

const DECADE_NEON: Record<number, string> = {
  1950: '#7cf2c9',
  1960: '#ff9f1c',
  1970: '#ffe14d',
  1980: '#ff5fae',
  1990: '#3ad7ff',
  2000: '#b6ff3b',
  2010: '#b9a0ff',
  2020: '#ff7a5c',
};

/** Blue Note-ish two-tone bands, one per decade. */
const JAZZ_BAND: Record<number, string> = {
  1910: '#b5482c',
  1920: '#b5482c',
  1930: '#1f5fbf',
  1940: '#d9772b',
  1950: '#127a6a',
  1960: '#17161a',
  1970: '#7b3fa0',
  1980: '#c23b5a',
  1990: '#2d6a4f',
  2000: '#e0592a',
  2010: '#1f5fbf',
  2020: '#127a6a',
};

function classicalInk(card: Card): string {
  if (card.tags.includes('film') || card.tags.includes('tv')) return '#8a6414';
  if (card.year < 1600) return '#4f6b3a';
  if (card.year < 1750) return '#7d1d2c';
  if (card.year < 1820) return '#284b7a';
  if (card.year < 1900) return '#6b2d5c';
  if (card.year < 1960) return '#2b2b2b';
  return '#2f6b6e';
}

const decade = (year: number) => Math.min(2020, Math.max(1910, Math.floor(year / 10) * 10));

export function cardColor(card: Card): string {
  if (card.set === 'regular') return DECADE_NEON[Math.max(1950, decade(card.year))] ?? '#ffe14d';
  if (card.set === 'jazz') return JAZZ_BAND[decade(card.year)] ?? '#1f5fbf';
  return classicalInk(card);
}

/** Small stable tilt per card, so the timeline looks laid down by hand. */
export function tilt(id: string, range = 1.4): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return `${(((h % 1000) / 1000) * range).toFixed(2)}deg`;
}

const vars = (card: Card, extra: Record<string, string> = {}) =>
  ({ '--card-color': cardColor(card), '--tilt': tilt(card.id), ...extra }) as CSSProperties;

function yearSize(label: string): string {
  if (label.length <= 4) return '1em';
  if (label.length <= 7) return '0.78em';
  return '0.56em';
}

export function CardFace({ card }: { card: Card }) {
  const year = (
    <div className="face-year" style={{ fontSize: `calc(var(--face-year) * ${parseFloat(yearSize(card.yearLabel))})` }}>
      {card.yearLabel}
      {card.yearNote && <small>{card.yearNote}</small>}
    </div>
  );
  return (
    <div className={`face card-${card.set}`} style={vars(card)}>
      {card.set === 'jazz' ? (
        <div className="face-band">
          <span>{card.primary}</span>
        </div>
      ) : (
        <div className="face-top">{card.primary}</div>
      )}
      {year}
      <div className="face-bottom">
        <span className="face-title">{card.secondary}</span>
        {card.excerpt && <span className="face-excerpt">{card.excerpt}</span>}
      </div>
    </div>
  );
}

export function CardBack({ set, spinning = false }: { set: SetId; spinning?: boolean }) {
  return (
    <div className={`back back-${set}${spinning ? ' is-spinning' : ''}`}>
      <div className="back-art" />
      <div className="back-mark">?</div>
    </div>
  );
}

export function CardStrip({ card, stamp, fresh }: { card: Card; stamp?: 'hit' | 'miss'; fresh?: boolean }) {
  return (
    <div className={`strip card-${card.set}${fresh ? ' is-fresh' : ''}`} style={vars(card)}>
      <div className="strip-year">
        <span style={{ fontSize: yearSize(card.yearLabel) }}>{card.yearLabel}</span>
        {card.yearNote && <small>{card.yearNote}</small>}
      </div>
      <div className="strip-body">
        <b>{card.primary}</b>
        <span>{card.secondary}</span>
      </div>
      {stamp && (
        <div className={`stamp stamp-${stamp}`}>
          <Icon name={stamp === 'hit' ? 'check' : 'cross'} size={26} />
        </div>
      )}
    </div>
  );
}

export function MysteryStrip({ set, label, color }: { set: SetId; label: string; color: string }) {
  return (
    <div className={`strip strip-mystery back-${set}`} style={{ '--token': color } as CSSProperties}>
      <div className="strip-year">?</div>
      <div className="strip-body">
        <b>{label}</b>
      </div>
    </div>
  );
}

export function Token({ name, color, size = 26 }: { name: string; color: string; size?: number }) {
  return (
    <span className="token" style={{ '--token': color, width: size, height: size, fontSize: size * 0.46 } as CSSProperties}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export const PLAYER_COLORS = ['#ff4f9a', '#2ec5ff', '#ffd23f', '#5ee6a8', '#ff8a3d', '#a98bff', '#ff5d5d', '#a6e22e'];
