import { useEffect, type CSSProperties, type ReactNode } from 'react';
import type { SetId } from '../../engine/types';
import { GrabbyHand, JazzCat, Phantom, Vinyl } from './characters';
import { burst } from './confetti';

export type FxKind = 'hit' | 'steal' | 'miss';

export interface FxEvent {
  id: number;
  kind: FxKind;
  set: SetId;
  /** Who it happened to: the active player for hit/miss, the thief for a steal. */
  who: string;
  loot: string;
}

const DURATION: Record<FxKind, number> = { hit: 2300, steal: 3600, miss: 2400 };

function content(e: FxEvent): ReactNode {
  if (e.kind === 'hit') {
    if (e.set === 'jazz')
      return (
        <div className="sticker sticker-ticket">
          <span>Swingin'!</span>
          <small>{e.who} nailed it</small>
        </div>
      );
    if (e.set === 'classical')
      return (
        <div className="sticker sticker-ribbon">
          <span>Bravo!</span>
          <small>{e.who}, bravissimo</small>
        </div>
      );
    return (
      <>
        <div className="sticker sticker-burst">
          <span>Hit!</span>
        </div>
        <p className="fx-caption">{e.who} nailed it</p>
      </>
    );
  }
  if (e.kind === 'steal') {
    if (e.set === 'jazz')
      return (
        <>
          <div className="spotlight" />
          <div className="walker">
            <JazzCat />
          </div>
          <p className="fx-caption">{e.who} steals the show</p>
        </>
      );
    if (e.set === 'classical')
      return (
        <>
          <div className="sweeper">
            <Phantom />
          </div>
          <p className="fx-caption">The phantom strikes. {e.who} takes it</p>
        </>
      );
    return (
      <>
        <div className="sticker sticker-yoink">
          <span>Yoink!</span>
        </div>
        <div className="dropper">
          <GrabbyHand />
        </div>
        <p className="fx-caption">{e.who} yoinks it</p>
      </>
    );
  }
  if (e.set === 'jazz')
    return (
      <>
        <div className="wahwah">
          <span>wah</span>
          <span>wah</span>
          <span>wahhh</span>
        </div>
        <p className="fx-caption">Sad trombone for {e.who}</p>
      </>
    );
  if (e.set === 'classical')
    return (
      <>
        <div className="string">
          <i />
          <i />
        </div>
        <p className="fx-caption fx-caption-late">Out of tune, {e.who}</p>
      </>
    );
  return (
    <>
      <div className="scratcher">
        <Vinyl />
      </div>
      <div className="sticker sticker-scratch">
        <span>Scratch!</span>
      </div>
      <p className="fx-caption">Off the record, {e.who}</p>
    </>
  );
}

export function Fx({ event, onDone }: { event: FxEvent; onDone: () => void }) {
  useEffect(() => {
    if (event.kind === 'hit') burst(event.set);
    const t = setTimeout(onDone, DURATION[event.kind]);
    return () => clearTimeout(t);
    // One run per event; onDone identity changes every render.
  }, [event.id]);

  return (
    <div
      className={`fx fx-${event.kind} fx-${event.set}`}
      style={{ '--loot': event.loot, '--fx-ms': `${DURATION[event.kind]}ms` } as CSSProperties}
      onClick={onDone}
      role="status"
    >
      {content(event)}
    </div>
  );
}
