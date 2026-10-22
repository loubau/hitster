import { useEffect, useRef } from 'react';
import type { PlaybackControls } from '../audio/usePlayback';
import type { RoomClient } from './client';
import { DRIFT_CHECK_MS, syncStep } from './playback';
import type { Control } from './protocol';

/** Let a seek land before telling everyone where the host is now. */
const SETTLE_MS = 400;

/**
 * Room audio. The host's player is the reference: it broadcasts a tune on every play, pause, seek
 * and new card, and every few seconds while playing. Every guest's player (muted or not) follows
 * the latest tune. Returns this device's transport: the host drives its own player; a guest who
 * may control it (whoever is placing) sends the press to the host.
 */
export function useRoomPlayback(client: RoomClient | null, isHost: boolean, pb: PlaybackControls, cardId: string | undefined, draw: number) {
  const provider = pb.provider;
  const tuneRef = useRef<() => void>(() => {});

  // Host: announce where its player is.
  useEffect(() => {
    if (!client || !isHost) return;
    let live = false;
    let videoId: string | undefined;
    const tune = () => {
      // The previous card can still be loaded for a moment after a draw.
      if (!cardId || provider.cardId !== cardId) return;
      client.sendTune({ draw, videoId: provider.videoId, start: provider.start, playing: live, pos: provider.currentTime(), at: client.hostNow() });
    };
    tuneRef.current = tune;
    const off = provider.subscribe((p) => {
      // Buffering counts as stopped: guests should not run on while the host's video stands still.
      const nowLive = p.playing && !provider.buffering();
      if (nowLive === live && provider.videoId === videoId) return;
      live = nowLive;
      videoId = provider.videoId;
      tune();
    });
    const beat = setInterval(() => live && tune(), DRIFT_CHECK_MS);
    tune();
    return () => {
      off();
      clearInterval(beat);
      tuneRef.current = () => {};
    };
  }, [client, isHost, provider, cardId, draw]);

  // Host: guests' transport presses.
  useEffect(() => {
    if (!client || !isHost) return;
    return client.onControl((c: Control) => {
      if (c.op === 'toggle') return provider.buffering() || pb.playing ? provider.pause() : provider.play();
      if (c.op === 'restart') provider.restart();
      else provider.seekBy(c.by);
      setTimeout(() => tuneRef.current(), SETTLE_MS);
    });
  }, [client, isHost, provider, pb.playing]);

  // Guest: follow the host.
  useEffect(() => {
    if (!client || isHost) return;
    let lastCheck = 0;
    let lastAt = -1;
    let playing = false;
    let wasBuffering = false;
    const follow = (now: boolean) => {
      const t = client.currentTune;
      if (!t || t.draw !== draw || !cardId || provider.cardId !== cardId) return;
      if (t.videoId && provider.videoId !== t.videoId) pb.prefer(t.videoId, t.start);
      if (provider.buffering()) return;
      const fresh = t.at !== lastAt;
      if (!now && !fresh && Date.now() - lastCheck < DRIFT_CHECK_MS) return;
      lastCheck = Date.now();
      lastAt = t.at;
      const step = syncStep(
        { playing, time: provider.currentTime(), videoId: provider.videoId, start: provider.start },
        t,
        client.hostNow(),
      );
      if (step.pause) provider.pause();
      // Seek first: on a clip that is only cued, play() starts at the pending seek.
      if (step.seek !== undefined) provider.seekTo(step.seek);
      if (step.play) provider.play();
    };
    const off = provider.subscribe((p) => {
      playing = p.playing;
      // Started (or stopped buffering): line up now instead of at the next check.
      // Note it before following: follow's seek notifies again, synchronously.
      const buffering = provider.buffering();
      const settled = wasBuffering && !buffering;
      wasBuffering = buffering;
      if (settled) follow(true);
    });
    const offTune = client.onTune(() => follow(true));
    const check = setInterval(() => follow(false), 1000);
    follow(true);
    return () => {
      off();
      offTune();
      clearInterval(check);
    };
    // pb.prefer is a fresh closure every render; it only reads the provider, which is a dependency.
  }, [client, isHost, provider, cardId, draw]);

  if (!client) return { toggle: pb.toggle, restart: pb.restart, seekBy: pb.seekBy, canControl: true };
  const host = (fn: () => void) => () => {
    fn();
    setTimeout(() => tuneRef.current(), SETTLE_MS);
  };
  if (isHost) return { toggle: pb.toggle, restart: host(pb.restart), seekBy: (s: number) => host(() => pb.seekBy(s))(), canControl: true };
  return {
    toggle: () => client.control({ op: 'toggle' }),
    restart: () => client.control({ op: 'restart' }),
    seekBy: (by: number) => client.control({ op: 'seekBy', by }),
    canControl: client.mayControl(),
  };
}
