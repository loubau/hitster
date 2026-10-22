import { Fragment, useEffect, useRef } from 'react';
import type { Card } from '../engine/types';
import { CardStrip, MysteryStrip, Token } from './cards';
import { Icon } from './Icon';

export interface Marker {
  slot: number;
  name: string;
  color: string;
  correct?: boolean;
}

interface Props {
  cards: Card[];
  mystery: Card | null;
  selectable: boolean;
  selected: number | null;
  selectedBy: { name: string; color: string } | null;
  blocked: number[];
  markers: Marker[];
  /** After the reveal: the active player's slot, whether it was right, and where the card fits. */
  reveal: { slot: number; correct: boolean; fits: number[] } | null;
  freshId?: string;
  onSelect: (slot: number) => void;
}

function slotLabel(cards: Card[], i: number): string {
  if (cards.length === 0) return 'Anywhere';
  if (i === 0) return `Before ${cards[0].yearLabel}`;
  if (i === cards.length) return `After ${cards[cards.length - 1].yearLabel}`;
  return `${cards[i - 1].yearLabel} – ${cards[i].yearLabel}`;
}

export function Timeline(p: Props) {
  const selectedRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [p.selected, p.reveal?.slot]);

  const slots = Array.from({ length: p.cards.length + 1 }, (_, i) => i);
  return (
    <ol className="timeline">
      {slots.map((i) => {
        const isSel = p.selected === i;
        const isReveal = p.reveal?.slot === i;
        const ghost = !!p.reveal && !p.reveal.correct && p.reveal.fits.includes(i);
        const here = p.markers.filter((m) => m.slot === i);
        const blocked = p.blocked.includes(i);
        const open = p.selectable && !blocked;
        const cls = [
          'slot',
          isSel && 'is-selected',
          open && 'is-open',
          blocked && p.selectable && 'is-blocked',
          ghost && 'is-ghost',
          (here.length > 0 || isReveal) && 'has-content',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <Fragment key={i}>
            <li ref={isSel || isReveal ? selectedRef : undefined}>
              <button
                type="button"
                className={cls}
                disabled={!open}
                onClick={() => open && p.onSelect(i)}
                aria-label={`Place ${slotLabel(p.cards, i).toLowerCase()}`}
              >
                {isReveal && p.mystery ? (
                  <CardStrip card={p.mystery} stamp={p.reveal!.correct ? 'hit' : 'miss'} />
                ) : isSel && p.mystery && p.selectedBy ? (
                  <MysteryStrip set={p.mystery.set} label={`${p.selectedBy.name}'s pick`} color={p.selectedBy.color} />
                ) : ghost ? (
                  <span className="slot-label">It fits here</span>
                ) : here.length === 0 ? (
                  <span className="slot-label">{slotLabel(p.cards, i)}</span>
                ) : null}
                {here.length > 0 && (
                  <span className="slot-markers">
                    {here.map((m) => (
                      <span key={m.name} className={`marker${m.correct === undefined ? '' : m.correct ? ' is-right' : ' is-wrong'}`}>
                        <Token name={m.name} color={m.color} size={24} />
                        {m.name}
                        {m.correct !== undefined && <Icon name={m.correct ? 'check' : 'cross'} size={16} />}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            </li>
            {i < p.cards.length && (
              <li>
                <CardStrip card={p.cards[i]} fresh={p.cards[i].id === p.freshId} />
              </li>
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}
