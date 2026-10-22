import { useState } from 'react';
import type { Card } from '../engine/types';
import type { Feedback, Reason } from '../feedback';
import { CardStrip, MysteryStrip } from './cards';
import { Icon } from './Icon';

export interface FeedbackChoice {
  card: Card;
  /** The YouTube video that played for it, if any. */
  videoId?: string;
  /** Face down cards are shown without giving anything away. */
  revealed: boolean;
}

const REASONS: { id: Reason; label: string; help?: string }[] = [
  { id: 'incorrect-info', label: 'Incorrect info' },
  { id: 'bad-youtube', label: 'Bad YouTube link', help: 'Poor quality, wrong song, commentary, sound effects…' },
  { id: 'dislike', label: 'Dislike this card' },
];

interface Props {
  /** The current card first, then the last few revealed ones. */
  choices: FeedbackChoice[];
  /** The game adds where it is played (table or room). */
  onSend: (f: Omit<Feedback, 'mode' | 'roomCode'>) => void;
  onClose: () => void;
}

export function FeedbackSheet({ choices, onSend, onClose }: Props) {
  const [pick, setPick] = useState(0);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [text, setText] = useState('');
  const [nudge, setNudge] = useState(0);
  const ready = reasons.length > 0 || text.trim() !== '';

  const toggle = (id: Reason) => setReasons((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));
  const send = () => {
    if (!ready) return setNudge((n) => n + 1);
    const { card, videoId, revealed } = choices[pick];
    onSend({ cardId: card.id, set: card.set, reasons, text: text.trim(), videoId, revealed });
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet feedback" onClick={(e) => e.stopPropagation()}>
        <h2>Leave a note</h2>

        <h3 className="fb-label">Which card</h3>
        <div className="fb-cards" role="radiogroup" aria-label="Which card">
          {choices.map(({ card, revealed }, i) => (
            <button
              key={card.id}
              type="button"
              role="radio"
              aria-checked={pick === i}
              className={`fb-card${pick === i ? ' is-on' : ''}`}
              onClick={() => setPick(i)}
            >
              {revealed ? (
                <CardStrip card={card} />
              ) : (
                <MysteryStrip set={card.set} label={card.set === 'classical' ? 'The piece playing now' : 'The song playing now'} color="var(--ink)" />
              )}
            </button>
          ))}
        </div>

        <h3 className="fb-label">What's up</h3>
        <div className="fb-reasons">
          {REASONS.map((r) => {
            const on = reasons.includes(r.id);
            return (
              <button key={r.id} type="button" className={`fb-reason${on ? ' is-on' : ''}`} onClick={() => toggle(r.id)} aria-pressed={on}>
                <Icon name={on ? 'check' : 'plus'} size={16} />
                <span>{r.label}</span>
                {r.help && <small>{r.help}</small>}
              </button>
            );
          })}
        </div>
        <textarea
          className="fb-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Anything else? (optional)"
          maxLength={500}
          rows={3}
          aria-label="Your note"
        />

        {nudge > 0 && !ready && (
          <p className="form-error" key={nudge}>
            Pick a reason or write a line
          </p>
        )}
        <div className="fb-foot">
          <button type="button" className="ghost-btn" onClick={onClose}>
            Never mind
          </button>
          <button type="button" className={`slab${ready ? '' : ' is-waiting'}`} onClick={send}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
