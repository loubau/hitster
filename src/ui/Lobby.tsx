import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { encode } from 'uqr';
import { cardsFor } from '../data/cards';
import type { RoomClient, RoomView } from '../room/client';
import { roomLink } from '../room/code';
import { Icon } from './Icon';
import { PLAYER_COLORS, Token, tilt } from './cards';
import { loadPrefs, savePrefs } from './prefs';
import { RoomCode, inviteTo } from './RoomCode';
import { Rules, RulesSummary, dealProblem } from './Rules';

/** The room link as a QR code, for the phone next to you. */
function Qr({ text }: { text: string }) {
  const path = useMemo(() => {
    const { size, data } = encode(text, { ecc: 'M', border: 2 });
    let d = '';
    data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
    return { size, d };
  }, [text]);
  return (
    <svg className="qr" viewBox={`0 0 ${path.size} ${path.size}`} shapeRendering="crispEdges" role="img" aria-label="QR code for the room link">
      <rect width={path.size} height={path.size} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

interface Props {
  client: RoomClient;
  view: RoomView;
  onLeave: () => void;
}

export function Lobby({ client, view, onLeave }: Props) {
  const room = view.room!;
  const { code, isHost } = view;
  const me = view.me.id;
  const host = room.members.find((m) => m.id === room.hostId);
  const hostName = host?.name ?? 'the host';
  const [qr, setQr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const say = (text: string) => setToast({ id: Date.now(), text });
  const invite = inviteTo(code, say);
  const seated = room.members.length >= 2;
  const deckSize = cardsFor(room.settings).length;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => setError(null), [room.settings, room.members.length]);

  const deal = () => {
    if (!seated) return setError('Wait for at least one more player');
    const problem = dealProblem(room.settings, room.members.length);
    if (problem) return setError(problem);
    // The rules become this phone's defaults for the next game too.
    savePrefs({ ...loadPrefs(), settings: room.settings });
    client.startGame();
  };

  return (
    <div className="table theme-regular setup lobby">
      <header className="setup-head">
        <h1 className="wordmark">
          Hitster<span>{isHost ? 'your room' : `${hostName}'s room`}</span>
        </h1>
        <button type="button" className="ghost-btn" onClick={onLeave}>
          Leave
        </button>
      </header>

      {view.link !== 'live' ? (
        <p className="room-note">Reconnecting…</p>
      ) : view.hostAway ? (
        <p className="room-note">Waiting for {hostName} to come back…</p>
      ) : null}

      <section className="setup-block room-invite">
        <h2>Room code</h2>
        <RoomCode code={code} />
        <div className="invite-row">
          <button type="button" className="chip-btn" onClick={invite.copy}>
            Copy link
          </button>
          {invite.share && (
            <button type="button" className="chip-btn" onClick={invite.share}>
              Share
            </button>
          )}
          <button type="button" className="chip-btn" aria-expanded={qr} onClick={() => setQr((q) => !q)}>
            {qr ? 'Hide QR code' : 'QR code'}
          </button>
        </div>
        {qr && <Qr text={roomLink(code)} />}
      </section>

      <section className="setup-block">
        <h2>Who's here</h2>
        <div className="plates">
          {room.members.map((m, i) => (
            <span
              key={m.id}
              className={`plate${view.online.has(m.id) ? '' : ' is-away'}`}
              style={{ '--tilt': tilt(m.id + m.name, 4) } as CSSProperties}
            >
              <Token name={m.name} color={PLAYER_COLORS[i % PLAYER_COLORS.length]} size={24} />
              {m.name}
              {m.id === me && <em className="plate-tag">you</em>}
              {m.id === room.hostId && <em className="plate-tag">host</em>}
              {isHost && m.id !== me ? (
                <button type="button" aria-label={`Remove ${m.name}`} onClick={() => client.remove(m.id)}>
                  <Icon name="cross" size={14} />
                </button>
              ) : (
                <i className="plate-end" />
              )}
            </span>
          ))}
        </div>
        {!seated && <p className="room-blurb">Send the others the link or the code; they show up here.</p>}
      </section>

      {isHost ? <Rules settings={room.settings} onChange={(s) => client.setSettings(s)} /> : <RulesSummary settings={room.settings} host={hostName} />}

      <footer className="setup-foot">
        {isHost ? (
          <>
            {error && <p className="form-error">{error}</p>}
            <button type="button" className={`slab${seated ? '' : ' is-waiting'}`} onClick={deal}>
              Deal the cards
            </button>
            <p className={`deck-note${seated ? '' : ' is-hint'}`}>{seated ? `${deckSize} cards in the deck` : 'Waiting for at least one more player'}</p>
          </>
        ) : (
          <p className="deck-note is-hint">Waiting for {hostName} to deal</p>
        )}
      </footer>

      {toast && (
        <div className="toast" key={toast.id}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
