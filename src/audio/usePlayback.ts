import { useEffect, useMemo, useRef, useState } from 'react';
import type { Card } from '../engine/types';
import { MockProvider, type MusicProvider, type Playback } from './player';
import { YouTubeProvider, hasVideo } from './youtube';

interface Options {
  /** Start the track as soon as it is drawn (the table, a room's host); room guests wait for the host. */
  autoplay?: boolean;
  muted?: boolean;
}

/** Loads and starts the mystery card's track whenever a new card is drawn. */
export function usePlayback(card: Card | null, draw: number, { autoplay = true, muted = false }: Options = {}) {
  const mock = useMemo(() => new MockProvider(), []);
  // One YouTube player for the whole game: iOS only lets a player start itself after a tap inside it.
  const youtube = useMemo(() => new YouTubeProvider(), []);
  const provider: MusicProvider = card && hasVideo(card) ? youtube : mock;
  const [state, setState] = useState<Playback>({ playing: false, position: 0, duration: 1 });
  // Read when a card loads; a guest who becomes host starts autoplaying from the next card on.
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;

  useEffect(() => provider.subscribe(setState), [provider]);

  useEffect(() => youtube.setMuted(muted), [youtube, muted]);

  useEffect(() => {
    if (!card) return;
    let cancelled = false;
    if (provider !== youtube) youtube.unload();
    provider.load(card).then(() => !cancelled && autoplayRef.current && provider.play());
    return () => {
      cancelled = true;
      provider.pause();
    };
    // Reload only when a new card is drawn, not on every state change.
  }, [provider, draw]);

  return {
    ...state,
    label: provider.label,
    /** The YouTube video for this card, while YouTube is the one playing it. */
    videoId: provider === youtube ? youtube.videoId : undefined,
    /** Ref for the element the hidden YouTube player is mounted in. */
    host: youtube.mount,
    toggle: () => (state.playing ? provider.pause() : provider.play()),
    restart: () => provider.restart(),
    seekBy: (s: number) => provider.seekBy(s),
    /** Players flagged a video; see YouTubeProvider.report. */
    reportVideo: (videoId: string, cardId: string) => youtube.report(videoId, cardId),
    /** Room mode reaches past the buttons to keep devices in step. */
    provider,
    /** Room guests: play the host's video for this card; see YouTubeProvider.prefer. */
    prefer: (videoId: string, start: number) => provider === youtube && youtube.prefer(videoId, start),
  };
}

export type PlaybackControls = ReturnType<typeof usePlayback>;
