import type { CSSProperties } from 'react';
import type { Player } from '../engine/types';
import { tilt } from './cards';

interface Props {
  players: Player[];
  colors: Record<string, string>;
  activeId: string;
  highlightId?: string | null;
  target: number;
  /** In a room: this device's player, and players whose phone has dropped out. */
  meId?: string;
  away?: ReadonlySet<string>;
  onPeek: (id: string) => void;
}

export function Seats({ players, colors, activeId, highlightId, target, meId, away, onPeek }: Props) {
  return (
    <div className="seats">
      {players.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`seat${p.id === activeId ? ' is-active' : ''}${p.id === highlightId ? ' is-highlight' : ''}${away?.has(p.id) ? ' is-away' : ''}`}
          style={{ '--token': colors[p.id], '--tilt': tilt(p.id + p.name, 3) } as CSSProperties}
          onClick={() => onPeek(p.id)}
          aria-label={`${p.name}: ${p.timeline.length} cards, ${p.chips} chips. Show timeline`}
        >
          {p.id === meId && <span className="seat-you">you</span>}
          <span className="seat-name">{p.name}</span>
          <span className="seat-stats">
            <span className="seat-cards">
              <i className="mini-card" />
              {p.timeline.length}
              <em>/{target}</em>
            </span>
            <span className="seat-chips" aria-hidden="true">
              {Array.from({ length: p.chips }, (_, i) => (
                <i key={i} className="coin" />
              ))}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
