import { useState } from 'react';
import { cardsFor } from '../data/cards';
import { minTarget, sameCards, unusedCards } from '../engine/game';
import type { GameState, Settings } from '../engine/types';
import { Rules, RulesSummary, describeChanges } from './Rules';

interface Props {
  state: GameState;
  /** Left out at the table, where anyone may change them. */
  room?: { isHost: boolean; hostName: string };
  onSave: (settings: Settings) => void;
  onClose: () => void;
}

/** The rules mid-game, over the table: changed from the next card on, by the host in a room. */
export function HouseRules({ state, room, onSave, onClose }: Props) {
  const current = state.nextSettings ?? state.settings;
  const least = minTarget(state);
  const [draft, setDraft] = useState(() => ({ ...current, target: Math.max(current.target, least) }));
  const editable = !room || room.isHost;
  const set = state.current?.set ?? state.settings.sets[0];
  const changes = describeChanges(current, draft);
  const problem =
    draft.sets.length === 0
      ? 'Pick at least one set of cards'
      : !sameCards(current, draft) && unusedCards(state, cardsFor(draft)).length === 0
        ? 'Every card in these sets is already out'
        : null;

  const save = () => {
    if (problem) return;
    if (changes.length > 0) onSave(draft);
    onClose();
  };

  return (
    <div className={`table theme-${set} setup house-rules`} role="dialog" aria-modal="true" aria-label="House rules">
      <header className="setup-head">
        <h1 className="wordmark">
          House rules<span>{editable ? 'From the next card' : `Set by ${room?.hostName}`}</span>
        </h1>
        <button type="button" className="ghost-btn" onClick={onClose}>
          {editable ? 'Cancel' : 'Close'}
        </button>
      </header>

      {editable ? (
        <Rules settings={draft} onChange={setDraft} room={!!room} playing minTarget={least} />
      ) : (
        <RulesSummary settings={current} host={room?.hostName ?? ''} playing title="This game" />
      )}

      <footer className="setup-foot">
        {editable ? (
          <>
            {problem && <p className="form-error">{problem}</p>}
            <button type="button" className={`slab${problem || changes.length === 0 ? ' is-waiting' : ''}`} onClick={save}>
              Save
            </button>
            <p className="deck-note">The card in play finishes under the old rules</p>
          </>
        ) : (
          <button type="button" className="slab" onClick={onClose}>
            Back to the game
          </button>
        )}
      </footer>
    </div>
  );
}
