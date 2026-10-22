import { useEffect } from 'react';
import type { Player, SetId } from '../engine/types';
import { CardStrip } from './cards';
import { fireworks } from './fx/confetti';

export function Victory({ winner, color, set, onExit }: { winner: Player; color: string; set: SetId; onExit: () => void }) {
  useEffect(() => fireworks(set), [set]);
  return (
    <div className={`victory fx-${set}`}>
      <div className="victory-card">
        <p className="victory-kicker">{set === 'classical' ? 'Standing ovation for' : set === 'jazz' ? 'Top billing tonight' : 'And the winner is'}</p>
        <h1 style={{ color }}>{winner.name}</h1>
        <ol className="victory-timeline">
          {winner.timeline.map((c, i) => (
            <li key={c.id} style={{ animationDelay: `${0.5 + i * 0.06}s` }}>
              <CardStrip card={c} />
            </li>
          ))}
        </ol>
        <button type="button" className="slab" onClick={onExit}>
          New game
        </button>
      </div>
    </div>
  );
}
