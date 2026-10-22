import type { Card } from '../engine/types';
import type { MusicProvider, Playback } from './player';

/* Video ids per card, best first, written by scripts/resolve_youtube.py. "id@37" starts at 0:37. */
const files = import.meta.glob('/data/youtube.json', { eager: true, import: 'default' }) as Record<
  string,
  Record<string, string[]>
>;
const VIDEOS: Record<string, string[]> = Object.values(files)[0] ?? {};

export const hasVideo = (card: Card) => !!VIDEOS[card.id]?.length;

const FAILED_KEY = 'hitster.yt.failed';
/** YouTube refuses label music (error 150) in players embedded on localhost; deployed https works. */
const LOCAL = /^(localhost|127\.|\[::1\])/.test(location.hostname);

/** An IFrame API error code, or 'reported' when players flagged the video from the feedback sheet. */
type Failed = Record<string, { card: string; code: number | 'reported'; at: string }>;

function readFailed(): Failed {
  try {
    return JSON.parse(localStorage.getItem(FAILED_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/** Kept for a later review pass; the same id is tried last on the next game. */
function markFailed(id: string, card: string, code: Failed[string]['code']) {
  try {
    localStorage.setItem(FAILED_KEY, JSON.stringify({ ...readFailed(), [id]: { card, code, at: new Date().toISOString() } }));
  } catch {
    // Storage unavailable; the console line is enough.
  }
}

function rememberFailed(id: string, card: string, code: number) {
  console.warn(`[youtube] ${id} failed for ${card} (error ${code})`);
  if (LOCAL) return; // Not the video's fault; see LOCAL.
  markFailed(id, card, code);
}

interface Clip {
  videoId: string;
  startSeconds?: number;
}

function clipsFor(card: Card): Clip[] {
  const failed = readFailed();
  const clips = (VIDEOS[card.id] ?? []).map((v): Clip => {
    const [videoId, start] = v.split('@');
    return start ? { videoId, startSeconds: Number(start) } : { videoId };
  });
  return [...clips.filter((c) => !failed[c.videoId]), ...clips.filter((c) => failed[c.videoId])];
}

/* The slice of the IFrame Player API we use (https://developers.google.com/youtube/iframe_api_reference). */
interface YTPlayer {
  cueVideoById(clip: Clip): void;
  loadVideoById(clip: Clip): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getIframe(): HTMLIFrameElement;
}
interface YTEvent<T = unknown> {
  target: YTPlayer;
  data: T;
}
declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: {
          width: string;
          height: string;
          playerVars: Record<string, number>;
          events: Record<string, (e: YTEvent<number>) => void>;
        },
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const ENDED = 0;
const PLAYING = 1;
const PAUSED = 2;
const BUFFERING = 3;
const CUED = 5;

let api: Promise<void> | null = null;

function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  api ??= new Promise<void>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      api = null;
      script.remove();
      reject(new Error('YouTube IFrame API did not load'));
    };
    document.head.append(script);
  });
  return api;
}

type Status = 'loading' | 'ready' | 'blocked' | 'none' | 'offline';

/**
 * Plays the card through an invisible YouTube player laid over the deck.
 *
 * iOS only starts sound from a tap inside the iframe, so until this player has played once the
 * overlay takes taps (data-tap on the host): tapping the card starts the song. After that the same
 * player may be started from script, so the overlay lets taps through and the buttons drive it.
 */
export class YouTubeProvider implements MusicProvider {
  private state: Playback = { playing: false, position: 0, duration: 1 };
  private listeners = new Set<(p: Playback) => void>();
  private host: HTMLElement | null = null;
  private player: Promise<YTPlayer> | null = null;
  private yt: YTPlayer | null = null;
  private card: Card | null = null;
  private loads = 0;
  private queue: Clip[] = [];
  private clip: Clip | null = null;
  private tried = 0;
  /** The clip is only cued; the first play uses loadVideoById, the call iOS honours once unlocked. */
  private fresh = false;
  /** A cue is in flight: the player drops play and load calls sent before it lands. */
  private cueing = false;
  private wantPlay = false;
  private unlocked = false;
  private status: Status = 'loading';
  private timer: ReturnType<typeof setInterval> | null = null;
  private blockedCheck: ReturnType<typeof setTimeout> | null = null;

  get label(): string {
    switch (this.status) {
      case 'loading':
        return 'Loading YouTube…';
      case 'offline':
        return 'YouTube did not load';
      case 'blocked':
        return 'Tap the card to start the music';
      case 'none':
        return LOCAL ? 'No audio: YouTube blocks music on localhost' : 'No audio for this card';
      default:
        return this.tried > 1 ? `YouTube audio · backup ${this.tried - 1}` : 'YouTube audio';
    }
  }

  /** The video cued or playing now, if any. */
  get videoId(): string | undefined {
    return this.clip?.videoId;
  }

  /** Ref callback for the element the player lives in. */
  readonly mount = (el: HTMLElement | null) => {
    if (!el || el === this.host) return;
    this.host = el;
    this.player = null;
    this.yt = null;
    this.arm();
  };

  async load(card: Card): Promise<void> {
    const seq = ++this.loads;
    this.card = card;
    this.queue = clipsFor(card);
    this.tried = 0;
    this.wantPlay = false;
    this.status = 'loading';
    this.set({ playing: false, position: 0, duration: 1 });
    let yt: YTPlayer;
    try {
      yt = await this.ensurePlayer();
    } catch (err) {
      console.warn('[youtube]', err);
      if (seq === this.loads) {
        this.status = 'offline';
        this.set({});
      }
      return;
    }
    if (seq !== this.loads) return; // Loaded again meanwhile (next card, or StrictMode's second run).
    this.status = 'ready';
    this.next(yt);
  }

  /** Called when the drawn card has no videos and the silent provider takes over. */
  unload(): void {
    this.card = null;
    this.clip = null;
    this.cueing = false;
    this.wantPlay = false;
    this.clearBlockedCheck();
    this.stopPolling();
    this.yt?.stopVideo();
    this.arm();
  }

  /**
   * Players flagged this video (wrong song, commentary, poor sound...): it is tried last from now on,
   * and if it is the one playing, the card moves on to its next candidate straight away.
   */
  report(videoId: string, cardId: string): void {
    console.warn(`[youtube] ${videoId} reported for ${cardId}`);
    markFailed(videoId, cardId, 'reported');
    if (this.yt && this.card?.id === cardId && this.clip?.videoId === videoId) this.next(this.yt);
  }

  play(): void {
    const yt = this.yt;
    if (!yt || !this.clip) return;
    this.wantPlay = true;
    if (this.cueing) return; // onState starts it once the cue lands.
    if (this.fresh) yt.loadVideoById(this.clip);
    else yt.playVideo();
    this.fresh = false;
    // Fallback for browsers that refuse silently instead of firing onAutoplayBlocked.
    this.clearBlockedCheck();
    if (!this.unlocked) {
      this.blockedCheck = setTimeout(() => {
        const s = yt.getPlayerState();
        if (s !== PLAYING && s !== BUFFERING) this.blocked();
      }, 3000);
    }
  }

  pause(): void {
    this.wantPlay = false;
    this.clearBlockedCheck();
    this.stopPolling();
    if (this.yt && this.clip) this.yt.pauseVideo();
    this.set({ playing: false });
  }

  restart(): void {
    this.seek(this.clip?.startSeconds ?? 0);
  }

  seekBy(seconds: number): void {
    if (!this.yt) return;
    this.seek(this.yt.getCurrentTime() + seconds);
  }

  subscribe(listener: (p: Playback) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private seek(to: number) {
    const yt = this.yt;
    if (!yt || !this.clip) return;
    const duration = yt.getDuration() || this.state.duration;
    const position = Math.max(0, Math.min(to, duration - 1));
    yt.seekTo(position, true);
    this.set({ position });
  }

  private ensurePlayer(): Promise<YTPlayer> {
    const host = this.host;
    if (!host) return Promise.reject(new Error('No element to mount the YouTube player in'));
    this.player ??= loadApi().then(
      () =>
        new Promise<YTPlayer>((resolve) => {
          const slot = document.createElement('div');
          host.append(slot);
          new window.YT!.Player(slot, {
            width: '200',
            height: '200',
            playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, fs: 0, iv_load_policy: 3 },
            events: {
              onReady: (e) => {
                this.yt = e.target;
                e.target.getIframe().tabIndex = -1;
                resolve(e.target);
              },
              onStateChange: (e) => this.onState(e.data),
              onError: (e) => this.onError(e.data),
              onAutoplayBlocked: () => this.blocked(),
            },
          });
        }),
    );
    this.player.catch(() => (this.player = null));
    return this.player;
  }

  /** Cue the next candidate; autoplay it when a play was already asked for. */
  private next(yt: YTPlayer) {
    this.clip = this.queue.shift() ?? null;
    this.cueing = false;
    this.stopPolling();
    if (!this.clip) {
      this.status = 'none';
      this.wantPlay = false;
      yt.stopVideo();
      this.arm();
      this.set({ playing: false, position: 0, duration: 1 });
      return;
    }
    this.tried++;
    if (this.wantPlay) {
      yt.loadVideoById(this.clip);
      this.fresh = false;
    } else {
      yt.cueVideoById(this.clip);
      this.fresh = true;
      this.cueing = true;
    }
    this.arm();
    this.set({ position: this.clip.startSeconds ?? 0, duration: 1 });
  }

  private onError(code: number) {
    if (!this.yt || !this.clip || !this.card) return;
    rememberFailed(this.clip.videoId, this.card.id, code);
    this.next(this.yt);
  }

  private blocked() {
    if (this.unlocked || !this.clip) return;
    this.status = 'blocked';
    this.wantPlay = false;
    this.set({ playing: false });
  }

  private onState(s: number) {
    if (!this.clip) return;
    if (this.cueing) {
      // Until the cue lands, events belong to the previous clip (such as the pause on leaving it).
      if (s !== CUED) return;
      this.cueing = false;
      if (this.wantPlay) this.play();
      return;
    }
    if (s === PLAYING) {
      // Started, by script or by a tap inside the iframe: from now on scripts may start this player.
      this.unlocked = true;
      this.wantPlay = true;
      this.fresh = false;
      this.status = 'ready';
      this.clearBlockedCheck();
      this.arm();
    } else if (s === PAUSED || s === ENDED) {
      this.wantPlay = false;
    }
    const playing = s === PLAYING || (s === BUFFERING && this.wantPlay);
    if (playing && !this.timer) this.timer = setInterval(() => this.poll(), 250);
    if (!playing) this.stopPolling();
    this.poll(playing, s === ENDED);
  }

  private poll(playing = this.state.playing, ended = false) {
    const yt = this.yt;
    if (!yt) return;
    const duration = yt.getDuration() || this.state.duration;
    this.set({ playing, duration, position: ended ? duration : yt.getCurrentTime() });
  }

  /** Let the hidden player take taps on the deck until it has played once. */
  private arm() {
    if (!this.host) return;
    if (this.clip && !this.unlocked) this.host.dataset.tap = '';
    else delete this.host.dataset.tap;
  }

  private stopPolling() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private clearBlockedCheck() {
    if (this.blockedCheck) clearTimeout(this.blockedCheck);
    this.blockedCheck = null;
  }

  /** Always a fresh object, so a label-only change still re-renders. */
  private set(patch: Partial<Playback>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }
}
