import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ALL_CARDS, cardsFor } from '../data/cards';
import type { Settings } from '../engine/types';
import { localRoomCache } from '../room/cache';
import { RoomClient, type RoomView } from '../room/client';
import { forgetIdentity, saveIdentity, type Identity } from '../room/identity';
import { connectRealtime, roomStore } from '../room/supabase';
import { useWakeLock } from '../room/wakeLock';
import { Game } from './Game';
import { Lobby } from './Lobby';
import { RoomCode } from './RoomCode';

const CARD_BY_ID = new Map(ALL_CARDS.map((c) => [c.id, c]));
const cardById = (id: string) => CARD_BY_ID.get(id);
const idle = () => () => {};

interface Props {
  code: string;
  identity: Identity;
  /** Opening the room on this device: its first rules. */
  create?: { settings: Settings };
  onLeave: () => void;
}

/** One device in a room: connects, then shows the lobby or this player's view of the game. */
export default function RoomScreen({ code, identity, create, onLeave }: Props) {
  // A room is opened once: after that (a reload, React remounting) this device rejoins it.
  const opening = useRef(create);
  const [client, setClient] = useState<RoomClient | null>(null);
  const [muted, setMuted] = useState(identity.muted);

  useEffect(() => {
    const c = new RoomClient({
      code,
      me: { id: identity.id, name: identity.name },
      connect: connectRealtime,
      store: roomStore,
      cache: localRoomCache,
      cardById,
      cardsFor,
      create: opening.current,
    });
    opening.current = undefined;
    c.start();
    setClient(c);
    return () => c.stop();
  }, [code, identity.id, identity.name]);

  const view = useSyncExternalStore(client?.subscribe ?? idle, () => client?.view ?? null);
  useWakeLock(true);

  const status = view?.status;
  useEffect(() => {
    if (status === 'removed') forgetIdentity(code);
  }, [status, code]);

  const mute = (m: boolean) => {
    setMuted(m);
    saveIdentity(code, { ...identity, muted: m });
  };

  /** A lobby seat is given up for good; a seat in a running game stays, to come back to. */
  const leave = () => {
    const room = client?.view.room;
    if (!room?.game || room.game.phase === 'over') {
      client?.leave();
      forgetIdentity(code);
    }
    onLeave();
  };

  if (!client || !view || view.status !== 'in' || !view.room) return <Waiting code={code} view={view} onLeave={leave} />;
  if (!view.room.game) return <Lobby client={client} view={view} onLeave={leave} />;
  return (
    <Game
      state={view.room.game}
      dispatch={(a) => void client.dispatch(a)}
      onExit={leave}
      room={{ client, view, muted, onMute: mute }}
    />
  );
}

function Waiting({ code, view, onLeave }: { code: string; view: RoomView | null; onLeave: () => void }) {
  const status = view?.status ?? 'connecting';
  const text =
    status === 'removed'
      ? ['You were taken out of this room', 'Ask the host for a new invite if that was a mistake.']
      : status === 'missing'
        ? ['No room with this code (yet)', 'Check the four letters with whoever opened it. This page keeps listening and joins as soon as it is open.']
        : status === 'joining'
          ? ['Knocking on the door…', 'The host lets you in in a moment.']
          : view?.link === 'down'
            ? ['Trying to reach the room…', 'Check your connection; this page keeps trying.']
            : ['Finding the room…', ''];
  return (
    <div className="table theme-regular setup room-wait">
      <header className="setup-head">
        <h1 className="wordmark">
          Hitster<span>room</span>
        </h1>
      </header>
      <section className="setup-block">
        <RoomCode code={code} />
        <p className="room-wait-title">{text[0]}</p>
        {text[1] && <p className="room-blurb">{text[1]}</p>}
      </section>
      <footer className="setup-foot">
        <button type="button" className="ghost-btn" onClick={onLeave}>
          {status === 'removed' || status === 'missing' ? 'Back' : 'Leave'}
        </button>
      </footer>
    </div>
  );
}
