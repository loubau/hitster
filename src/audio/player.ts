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
}

/** Silent stand-in that only moves a playhead, so the table can be tried without an account. */
export class MockProvider implements MusicProvider {
  readonly label = 'Demo playback, no audio yet';
  private state: Playback = { playing: false, position: 0, duration: 180 };
  private listeners = new Set<(p: Playback) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  async load(): Promise<void> {
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
    this.set({ position: Math.max(0, Math.min(this.state.duration, this.state.position + seconds)) });
  }
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
