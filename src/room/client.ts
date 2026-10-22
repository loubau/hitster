import { reduce, type Action } from '../engine/game';
import type { Card, GameState, Settings } from '../engine/types';
import { HOST_GRACE_MS, electHost, mayAct, mayControl, type Asker } from './authority';
import { CLOCK_BURST, Clock, clockSample } from './clock';
import { decodeRoom, encodeRoom, isNewer, isWireRoom, type Control, type Member, type Msg, type Room, type Tune, type WireRoom } from './protocol';
import { dealGame, seatLatecomer, uniqueName } from './roster';
import { challengesOpen, nextTimer, timeUp } from './timer';

export type LinkStatus = 'connecting' | 'live' | 'down';

export interface LinkEvents {
  message(msg: Msg): void;
  /** Presence keys (player ids) online in the room, on every change. */
  presence(ids: string[]): void;
  status(s: LinkStatus): void;
}

/** One device's connection to the room's channel. */
export interface Link {
  send(msg: Msg): void;
  close(): void;
}

export type Connect = (code: string, me: Member, events: LinkEvents) => Link;

/** Where the host keeps the latest room, so it survives everyone reloading. */
export interface RoomStore {
  load(code: string): Promise<WireRoom | null>;
  save(room: WireRoom): Promise<void>;
}

/** This device's own copy, for an instant screen after a reload. */
export interface RoomCache {
  read(code: string): WireRoom | null;
  write(room: WireRoom): void;
}

export type RoomStatus =
  /** Looking for the room. */
  | 'connecting'
  /** Found it; waiting for the host to let us in. */
  | 'joining'
  | 'in'
  /** Nobody answered and nothing is stored under this code (still listening). */
  | 'missing'
  | 'removed';

export interface RoomView {
  code: string;
  me: Member;
  status: RoomStatus;
  link: LinkStatus;
  /** The room as this device shows it: the host's latest plus this guest's unconfirmed moves. */
  room: Room | null;
  isHost: boolean;
  online: ReadonlySet<string>;
  /** The host has been gone from presence for a few seconds; someone takes over at HOST_GRACE_MS. */
  hostAway: boolean;
}

export interface RoomOptions {
  code: string;
  me: Member;
  connect: Connect;
  store?: RoomStore | null;
  cache?: RoomCache | null;
  cardById: (id: string) => Card | undefined;
  cardsFor: (s: Settings) => Card[];
  /** Opening a new room on this device; leave out to join one. */
  create?: { settings: Settings };
}

/** No room after this long: say so (and keep listening). */
const MISSING_AFTER = 6000;
/** Ask again while not let in yet: a hello can go out before the host is listening. */
const HELLO_RETRY = 3000;
/** Predictions the host never confirmed are dropped after this. */
const PENDING_TTL = 4000;
/** Show "waiting for the host" after this. */
const HOST_AWAY_AFTER = 2500;
const CLOCK_REFRESH = 20_000;
const CLOCK_SPACING = 300;
const SAVE_DEBOUNCE = 1000;
const TICK = 500;

interface Pending {
  n: number;
  action: Action;
  at: number;
}

/**
 * One device in a room: the host's arbiter, or a guest's mirror of the host. The same object
 * switches role when the room says so, which is all a failover is.
 */
export class RoomClient {
  readonly code: string;
  readonly me: Member;
  private opts: RoomOptions;
  private link: Link | null = null;
  private linkStatus: LinkStatus = 'connecting';
  private room: Room | null = null;
  private pending: Pending[] = [];
  /** Intent numbers keep rising across reloads, so a fresh page never reuses an acked one. */
  private n = Date.now();
  private online = new Set<string>();
  /** Presence arrived since the link came up; until then nobody counts as gone. */
  private presenceSeen = false;
  private hostGoneAt: number | null = null;
  private missing = false;
  private startedAt = 0;
  private lastHello = 0;
  private lastPing = 0;
  private clock = new Clock();
  private tune: Tune | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private tick: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Host: turns the card over when the challenge timer runs out. */
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private tuneListeners = new Set<(t: Tune | null) => void>();
  private controlListeners = new Set<(c: Control) => void>();
  private shown: { room: Room | null; pending: Pending[]; value: Room | null } = { room: null, pending: [], value: null };
  private snapshot: RoomView;

  constructor(opts: RoomOptions) {
    this.opts = opts;
    this.code = opts.code;
    this.me = opts.me;
    this.snapshot = this.build();
  }

  start() {
    this.startedAt = Date.now();
    const { create, cache, store } = this.opts;
    if (create) {
      this.room = {
        code: this.code,
        hostId: this.me.id,
        term: 1,
        seq: 1,
        settings: create.settings,
        members: [this.me],
        removed: [],
        game: null,
        acks: {},
      };
      this.keep(true);
    } else {
      const cached = cache?.read(this.code);
      if (cached && isWireRoom(cached)) this.adopt(this.decode(cached));
      store
        ?.load(this.code)
        .then((stored) => stored && isWireRoom(stored) && this.adopt(this.decode(stored)))
        .catch((err) => console.warn('[room] could not read the stored room', err));
    }
    this.link = this.opts.connect(this.code, this.me, {
      message: (m) => this.onMessage(m),
      presence: (ids) => this.onPresence(ids),
      status: (s) => this.onLink(s),
    });
    this.tick = setInterval(() => this.onTick(), TICK);
    this.emit();
  }

  stop() {
    if (this.tick) clearInterval(this.tick);
    if (this.expiry) clearTimeout(this.expiry);
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.save();
    }
    this.link?.close();
    this.link = null;
  }

  // ---------- reading ----------

  get view(): RoomView {
    return this.snapshot;
  }

  readonly subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  get isHost(): boolean {
    return !!this.room && this.room.hostId === this.me.id;
  }

  /** The host's clock, as far as this device can tell. */
  hostNow(): number {
    return Date.now() + (this.isHost ? 0 : this.clock.offset);
  }

  /** The host's latest playback, for guests to follow. */
  get currentTune(): Tune | null {
    return this.tune;
  }

  onTune(fn: (t: Tune | null) => void) {
    this.tuneListeners.add(fn);
    return () => void this.tuneListeners.delete(fn);
  }

  /** Host only: transport buttons pressed on guests' phones. */
  onControl(fn: (c: Control) => void) {
    this.controlListeners.add(fn);
    return () => void this.controlListeners.delete(fn);
  }

  /** Whether this device may take the action now, judged on what it shows. */
  may(a: Action): boolean {
    const game = this.snapshot.room?.game;
    return !!game && this.snapshot.status === 'in' && mayAct(game, a, this.asker(this.me.id));
  }

  mayControl(): boolean {
    return this.snapshot.status === 'in' && mayControl(this.snapshot.room?.game ?? null, this.asker(this.me.id));
  }

  // ---------- playing ----------

  /** A move on this device: applied straight away on the host, sent as an intent by a guest. */
  dispatch(a: Action): boolean {
    const room = this.room;
    if (!room?.game || !this.may(a)) return false;
    if (this.isHost) {
      this.commit({ ...room, game: reduce(room.game, a) });
      return true;
    }
    const n = ++this.n;
    // Challenges wait for the host: when two tap at once only one of them gets to pick.
    if (a.type !== 'startChallenge') this.pending = [...this.pending, { n, action: a, at: Date.now() }];
    this.send({ type: 'intent', from: this.me.id, to: room.hostId, n, action: a });
    this.emit();
    return true;
  }

  control(c: Control) {
    const room = this.room;
    if (!room || !this.mayControl()) return;
    if (this.isHost) this.controlListeners.forEach((l) => l(c));
    else this.send({ type: 'control', from: this.me.id, to: room.hostId, control: c });
  }

  /** Host only: where its own player is, for everyone else to follow. */
  sendTune(t: Tune) {
    if (!this.isHost) return;
    this.tune = t;
    this.send({ type: 'tune', from: this.me.id, tune: t });
  }

  // ---------- the host's lobby ----------

  setSettings(settings: Settings) {
    if (this.isHost && this.room && !this.room.game) this.commit({ ...this.room, settings });
  }

  startGame(seed = Date.now() % 2147483647) {
    const room = this.room;
    if (!this.isHost || !room || (room.game && room.game.phase !== 'over')) return;
    this.commit({ ...room, game: dealGame(room.settings, room.members, this.opts.cardsFor(room.settings), seed) });
  }

  /** Back to the lobby for everyone (after a win, or to change the rules). */
  endGame() {
    if (this.isHost && this.room?.game) this.commit({ ...this.room, game: null });
  }

  remove(id: string) {
    const room = this.room;
    if (!this.isHost || !room || room.game || id === this.me.id) return;
    this.commit({ ...room, members: room.members.filter((m) => m.id !== id), removed: [...room.removed, id] });
  }

  /** Leaving for good: a lobby seat is given up; in a game the seat stays for a comeback. */
  leave() {
    if (this.room && !this.isHost && !this.room.game) this.send({ type: 'leave', from: this.me.id });
  }

  // ---------- internals ----------

  private asker(playerId: string): Asker {
    const room = this.room;
    return { playerId, hostId: room?.hostId ?? '', online: this.online, challengesOpen: challengesOpen(room?.timer, this.hostNow()) };
  }

  private decode(wire: WireRoom): Room {
    return decodeRoom(wire, this.opts.cardById);
  }

  private send(msg: Msg) {
    this.link?.send(msg);
  }

  private hello() {
    this.lastHello = Date.now();
    this.send({ type: 'hello', from: this.me.id, name: this.me.name });
  }

  private ping() {
    const room = this.room;
    if (!room || this.isHost || this.linkStatus !== 'live') return;
    this.lastPing = Date.now();
    this.send({ type: 'ping', from: this.me.id, to: room.hostId, t0: Date.now() });
  }

  private syncClock() {
    for (let i = 0; i < CLOCK_BURST; i++) this.later(() => this.ping(), i * CLOCK_SPACING);
  }

  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  /** Host: a change to the room. */
  private commit(next: Room) {
    this.room = { ...next, seq: next.seq + 1, timer: nextTimer(next.game, next.timer, Date.now()) };
    this.armExpiry();
    this.keep(true);
    this.send({ type: 'state', room: encodeRoom(this.room) });
    this.emit();
  }

  /** Remember the room on this device, and (host) in the store a moment later. */
  private keep(store: boolean) {
    if (!this.room) return;
    try {
      this.opts.cache?.write(encodeRoom(this.room));
    } catch {
      // A cache is a convenience.
    }
    if (!store || !this.opts.store) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, SAVE_DEBOUNCE);
  }

  private save() {
    if (!this.isHost || !this.room || !this.opts.store) return;
    // Live play runs over broadcast; a failed save only costs the resume-after-everyone-reloads.
    this.opts.store.save(encodeRoom(this.room)).catch((err) => console.warn('[room] could not store the room', err));
  }

  /** Take a room from the host, the store or this device's cache, if it is newer than ours. */
  private adopt(next: Room) {
    if (next.code !== this.code || !isNewer(next, this.room)) return;
    const prevHost = this.room?.hostId;
    this.room = next;
    this.armExpiry();
    // Never reuse a number the host has seen, whatever this device's clock did since.
    this.n = Math.max(this.n, next.acks[this.me.id] ?? 0);
    this.keep(false);
    if (next.hostId !== prevHost) {
      // Predictions and clock were for the old host.
      this.pending = [];
      this.clock.reset();
      this.setTune(null);
      if (!this.isHost) this.syncClock();
    } else {
      const ack = next.acks[this.me.id] ?? 0;
      this.pending = this.pending.filter((p) => p.n > ack);
    }
    this.watchHost();
    this.emit();
  }

  private setTune(t: Tune | null) {
    this.tune = t;
    this.tuneListeners.forEach((l) => l(t));
  }

  private onLink(s: LinkStatus) {
    this.linkStatus = s;
    if (s === 'live') {
      this.hello();
      if (this.room && !this.isHost) this.syncClock();
    } else {
      // Our own connection is the one in doubt: nobody is "gone" until presence says so again.
      this.presenceSeen = false;
      this.hostGoneAt = null;
    }
    this.emit();
  }

  private onPresence(ids: string[]) {
    this.online = new Set(ids);
    this.online.add(this.me.id);
    this.presenceSeen = this.linkStatus === 'live';
    this.watchHost();
    this.emit();
  }

  /** Failover: when the host has been missing from presence long enough, the earliest member takes over. */
  private watchHost() {
    const room = this.room;
    if (!room || this.isHost || !this.presenceSeen || this.online.has(room.hostId)) {
      this.hostGoneAt = null;
      return;
    }
    this.hostGoneAt ??= Date.now();
    if (Date.now() - this.hostGoneAt < HOST_GRACE_MS) return;
    if (electHost(room.members, this.online, room.hostId) !== this.me.id) return;
    console.info(`[room] host ${room.hostId} is gone; taking over ${room.code}`);
    this.hostGoneAt = null;
    this.pending = [];
    // The deadline is in the old host's clock; carry it over into ours.
    const t = room.timer;
    const timer = t && 'ends' in t ? { ...t, ends: t.ends - this.clock.offset } : t;
    this.clock.reset();
    this.setTune(null);
    this.commit({ ...room, hostId: this.me.id, term: room.term + 1, timer });
  }

  /** Host: wait for the challenge timer, if one is running. */
  private armExpiry() {
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = null;
    const t = this.room?.timer;
    if (!this.isHost || !t || !('ends' in t)) return;
    this.expiry = setTimeout(() => {
      this.expiry = null;
      this.expire();
    }, Math.max(0, t.ends - Date.now()));
  }

  /** Host: time is up and nobody is picking, so challenges close and the card is turned over. */
  private expire() {
    const room = this.room;
    if (!this.isHost || !room?.game || !timeUp(room.game, room.timer, Date.now())) return;
    this.commit({ ...room, game: reduce(room.game, { type: 'reveal' }) });
  }

  private onTick() {
    const now = Date.now();
    let changed = false;
    if (this.pending.some((p) => now - p.at >= PENDING_TTL)) {
      this.pending = this.pending.filter((p) => now - p.at < PENDING_TTL);
      changed = true;
    }
    if (!this.room && !this.missing && now - this.startedAt > MISSING_AFTER) {
      this.missing = true;
      changed = true;
    }
    const status = this.status();
    if (this.linkStatus === 'live' && status !== 'in' && status !== 'removed' && now - this.lastHello > HELLO_RETRY) {
      this.hello();
    }
    if (this.linkStatus === 'live' && now - this.lastPing > CLOCK_REFRESH) this.ping();
    this.watchHost();
    if (changed || this.hostAway() !== this.snapshot.hostAway) this.emit();
  }

  private onMessage(msg: Msg) {
    const me = this.me.id;
    switch (msg.type) {
      case 'hello':
        return this.onHello(msg.from, msg.name);
      case 'state':
        if (isWireRoom(msg.room)) this.adopt(this.decode(msg.room));
        return;
      case 'intent':
        if (this.isHost && msg.to === me) this.onIntent(msg.from, msg.n, msg.action);
        return;
      case 'control':
        if (this.isHost && msg.to === me && mayControl(this.room?.game ?? null, this.asker(msg.from))) {
          this.controlListeners.forEach((l) => l(msg.control));
        }
        return;
      case 'leave':
        if (this.isHost && this.room && !this.room.game && msg.from !== me) {
          this.commit({ ...this.room, members: this.room.members.filter((m) => m.id !== msg.from) });
        }
        return;
      case 'ping':
        if (msg.to === me) this.send({ type: 'pong', from: me, to: msg.from, t0: msg.t0, t1: Date.now() });
        return;
      case 'pong':
        if (msg.to === me && msg.from === this.room?.hostId) this.clock.add(clockSample(msg.t0, msg.t1, Date.now()));
        return;
      case 'tune':
        if (!this.isHost && msg.from === this.room?.hostId) this.setTune(msg.tune);
        return;
    }
  }

  private onHello(from: string, name: string) {
    const room = this.room;
    if (!room || from === this.me.id) return;
    if (!this.isHost) {
      // The host itself asking: it reloaded, perhaps without its copy. Hand ours back.
      if (from === room.hostId) this.send({ type: 'state', room: encodeRoom(room) });
      return;
    }
    if (!room.removed.includes(from) && !room.members.some((m) => m.id === from)) {
      const member = { id: from, name: uniqueName(name.trim().slice(0, 14) || 'Player', room.members) };
      this.commit({
        ...room,
        members: [...room.members, member],
        game: room.game && seatLatecomer(room.game, member),
      });
    } else {
      this.send({ type: 'state', room: encodeRoom(room) });
    }
    if (this.tune && room.game?.draw === this.tune.draw) this.send({ type: 'tune', from: this.me.id, tune: this.tune });
  }

  private onIntent(from: string, n: number, action: Action) {
    const room = this.room;
    if (!room?.game || !room.members.some((m) => m.id === from)) return;
    // A copy of a move already handled (a resend, a reconnect) must not be played twice.
    if (n <= (room.acks[from] ?? 0)) return;
    const game: GameState = mayAct(room.game, action, this.asker(from)) ? reduce(room.game, action) : room.game;
    // Committed even when refused: the ack tells the guest to drop its prediction.
    this.commit({ ...room, game, acks: { ...room.acks, [from]: n } });
  }

  private status(): RoomStatus {
    const room = this.room;
    if (room?.removed.includes(this.me.id)) return 'removed';
    if (room?.members.some((m) => m.id === this.me.id)) return 'in';
    if (room) return 'joining';
    return this.missing ? 'missing' : 'connecting';
  }

  private hostAway(): boolean {
    return this.hostGoneAt !== null && Date.now() - this.hostGoneAt > HOST_AWAY_AFTER;
  }

  /** The host's room with this guest's unconfirmed moves replayed on top, kept while neither changes. */
  private shownRoom(): Room | null {
    const { room, pending } = this;
    if (this.shown.room !== room || this.shown.pending !== pending) {
      let value = room;
      if (room?.game && pending.length && !this.isHost) {
        value = { ...room, game: pending.reduce((g, p) => reduce(g, p.action), room.game) };
      }
      this.shown = { room, pending, value };
    }
    return this.shown.value;
  }

  private build(): RoomView {
    return {
      code: this.code,
      me: this.me,
      status: this.status(),
      link: this.linkStatus,
      room: this.shownRoom(),
      isHost: this.isHost,
      online: this.online,
      hostAway: this.hostAway(),
    };
  }

  private emit() {
    this.snapshot = this.build();
    this.listeners.forEach((l) => l());
  }
}
