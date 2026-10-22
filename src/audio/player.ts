import type { Card } from '../engine/types';

export interface Playback {
  playing: boolean;
  /** Seconds. */
  position: number;
  duration: number;
}

/** What the table needs from a streaming backend (Spotify Connect, YouTube, ...). */
export interface MusicProvider {
  readonly label: string;
  load(card: Card): Promise<void>;
  play(): void;
  pause(): void;
  restart(): void;
  seekBy(seconds: number): void;
  subscribe(listener: (p: Playback) => void): () => void;
  /* Room mode: guests follow the host's player. */
  seekTo(seconds: number): void;
  /** Seconds, read from the player now rather than from the last poll. */
  currentTime(): number;
  /** Asked to play but waiting on the network, so the position is standing still. */
  buffering(): boolean;
  /** Where the loaded clip starts ("id@37" starts at 37). */
  readonly start: number;
  /** The card loaded last, and its video when there is one. */
  readonly cardId: string | undefined;
  readonly videoId?: string;
  setMuted(muted: boolean): void;
}

/** Silent stand-in that only moves a playhead, so the table can be tried without an account. */
export class MockProvider implements MusicProvider {
  readonly label = 'Demo playback, no audio yet';
  private state: Playback = { playing: false, position: 0, duration: 180 };
  private listeners = new Set<(p: Playback) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  cardId: string | undefined;

  async load(card: Card): Promise<void> {
    this.cardId = card.id;
    this.set({ playing: false, position: 0, duration: 150 + Math.floor(Math.random() * 120) });
  }
  play(): void {
    if (this.timer) return;
    this.set({ playing: true });
    this.timer = setInterval(() => {
      const position = Math.min(this.state.duration, this.state.position + 0.25);
      this.set({ position, playing: position < this.state.duration });
      if (position >= this.state.duration) this.stop();
    }, 250);
  }
  pause(): void {
    this.stop();
    this.set({ playing: false });
  }
  restart(): void {
    this.set({ position: 0 });
  }
  seekBy(seconds: number): void {
    this.seekTo(this.state.position + seconds);
  }
  seekTo(seconds: number): void {
    this.set({ position: Math.max(0, Math.min(this.state.duration, seconds)) });
  }
  currentTime(): number {
    return this.state.position;
  }
  buffering(): boolean {
    return false;
  }
  readonly start = 0;
  setMuted(): void {}
  subscribe(listener: (p: Playback) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }
  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  private set(patch: Partial<Playback>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }
}
