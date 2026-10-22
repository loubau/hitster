import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activePlayer, newGame, reduce, type Action } from '../engine/game';
import type { Card, GameState, Settings } from '../engine/types';
import { electHost, mayAct, mayControl } from './authority';
import { Clock, clockSample, estimateOffset } from './clock';
import { RoomClient, type Connect, type LinkEvents, type RoomCache, type RoomStore } from './client';
import { CODE_LETTERS, newCode, normaliseCode } from './code';
import { decodeRoom, encodeRoom, isNewer, type Member, type Msg, type Room, type Tune, type WireRoom } from './protocol';
import { dealGame, seatLatecomer, uniqueName } from './roster';
import { hostPosition, syncStep, targetPosition } from './playback';
import { BEAT_MS, challengesOpen, nextTimer, timeUp } from './timer';

function card(id: string, year: number): Card {
  return {
    id,
    set: 'regular',
    year,
    yearLo: year,
    yearHi: year,
    yearLabel: String(year),
    primary: id,
    secondary: id,
    primaryLabel: 'Artist',
    secondaryLabel: 'Title',
    trivia: '',
    facts: [],
    region: 'intl',
    tags: [],
  };
}

const CARDS = Array.from({ length: 60 }, (_, i) => card(`c${i}`, 1950 + i));
const BY_ID = new Map(CARDS.map((c) => [c.id, c]));
const settings: Settings = {
  sets: ['regular'],
  target: 10,
  startChips: 2,
  maxChips: 5,
  variant: 'original',
  includeDutch: true,
  allowBuy: true,
  allowSkip: true,
};
const timed: Settings = { ...settings, challengeTimer: 10 };

describe('clock', () => {
  it('reads the offset from one round trip', () => {
    // Sent at 1000 ours, host stamped 5100, back at 1200 ours: midway is 1100, so the host is 4 s ahead.
    expect(clockSample(1000, 5100, 1200)).toEqual({ offset: 4000, rtt: 200 });
  });

  it('takes the median, so one slow pong does not drag it', () => {
    const samples = [4000, 4010, 3990, 4005, 6000].map((offset) => ({ offset, rtt: 100 }));
    expect(estimateOffset(samples)).toBe(4005);
    expect(estimateOffset([{ offset: 10, rtt: 1 }, { offset: 20, rtt: 1 }])).toBe(15);
    expect(estimateOffset([])).toBe(0);
  });

  it('ignores impossible and very slow round trips', () => {
    const c = new Clock();
    c.add({ offset: 50, rtt: 80 });
    c.add({ offset: 9000, rtt: 8000 });
    c.add({ offset: 9000, rtt: -5 });
    expect(c.offset).toBe(50);
    c.reset();
    expect(c.synced).toBe(false);
  });
});

describe('codes', () => {
  it('uses four letters without I or O', () => {
    for (let i = 0; i < 200; i++) {
      const code = newCode();
      expect(code).toMatch(/^[A-Z]{4}$/);
      expect(code).not.toMatch(/[IO]/);
    }
    expect(CODE_LETTERS).toHaveLength(24);
  });

  it('tidies what people type', () => {
    expect(normaliseCode(' ab-cd ')).toBe('ABCD');
    expect(normaliseCode('abc')).toBeNull();
    expect(normaliseCode('ABIO')).toBeNull();
  });
});

describe('authority', () => {
  const ids = ['host', 'ann', 'bob'];
  function game(): GameState {
    return dealGame(settings, ids.map((id) => ({ id, name: id })), CARDS, 7);
  }
  const all = new Set(ids);
  const who = (playerId: string, online: Set<string> = all) => ({ playerId, hostId: 'host', online });
  const play = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);

  it('lets only the active player place, lock in, skip and buy', () => {
    const s = game();
    expect(activePlayer(s).id).toBe('host');
    for (const a of [{ type: 'selectSlot', slot: 0 }, { type: 'lockIn' }, { type: 'skip' }, { type: 'buyCard' }] as Action[]) {
      expect(mayAct(s, a, who('host'))).toBe(true);
      expect(mayAct(s, a, who('ann'))).toBe(false);
    }
  });

  it('refuses skip and buy when the house rules leave them out', () => {
    const s = game();
    const off = { ...s, settings: { ...s.settings, allowBuy: false, allowSkip: false } };
    expect(mayAct(off, { type: 'skip' }, who('host'))).toBe(false);
    expect(mayAct(off, { type: 'buyCard' }, who('host'))).toBe(false);
    expect(mayAct(off, { type: 'lockIn' }, who('host'))).toBe(true);
  });

  it('lets the host stand in for an active player whose phone is gone', () => {
    const s = { ...game(), turn: 1 };
    expect(mayAct(s, { type: 'selectSlot', slot: 0 }, who('host'))).toBe(false);
    expect(mayAct(s, { type: 'selectSlot', slot: 0 }, who('host', new Set(['host', 'bob'])))).toBe(true);
    expect(mayAct(s, { type: 'selectSlot', slot: 0 }, who('bob', new Set(['host', 'bob'])))).toBe(false);
  });

  it('lets each player challenge only for themselves, while nobody is picking', () => {
    const s = play(game(), { type: 'selectSlot', slot: 0 }, { type: 'lockIn' });
    expect(mayAct(s, { type: 'startChallenge', playerId: 'ann' }, who('ann'))).toBe(true);
    expect(mayAct(s, { type: 'startChallenge', playerId: 'bob' }, who('ann'))).toBe(false);
    expect(mayAct(s, { type: 'startChallenge', playerId: 'host' }, who('host'))).toBe(false);
    const picking = reduce(s, { type: 'startChallenge', playerId: 'ann' });
    expect(mayAct(picking, { type: 'startChallenge', playerId: 'bob' }, who('bob'))).toBe(false);
    expect(mayAct(picking, { type: 'selectSlot', slot: 1 }, who('ann'))).toBe(true);
    expect(mayAct(picking, { type: 'selectSlot', slot: 1 }, who('bob'))).toBe(false);
    expect(mayAct(picking, { type: 'lockChallenge' }, who('host'))).toBe(false);
    expect(mayAct(picking, { type: 'cancelChallenge' }, who('host'))).toBe(true);
    expect(mayAct(picking, { type: 'cancelChallenge' }, who('bob'))).toBe(false);
  });

  it('refuses a challenge once the challenge timer has run out', () => {
    const s = play(game(), { type: 'selectSlot', slot: 0 }, { type: 'lockIn' });
    const a: Action = { type: 'startChallenge', playerId: 'ann' };
    expect(mayAct(s, a, { ...who('ann'), challengesOpen: true })).toBe(true);
    expect(mayAct(s, a, { ...who('ann'), challengesOpen: false })).toBe(false);
  });

  it('leaves reveal, naming and next to the active player or the host', () => {
    let s = play({ ...game(), turn: 1 }, { type: 'selectSlot', slot: 0 }, { type: 'lockIn' });
    expect(mayAct(s, { type: 'reveal' }, who('ann'))).toBe(true);
    expect(mayAct(s, { type: 'reveal' }, who('host'))).toBe(true);
    expect(mayAct(s, { type: 'reveal' }, who('bob'))).toBe(false);
    s = reduce(s, { type: 'reveal' });
    expect(mayAct(s, { type: 'toggleNamed', field: 'primary' }, who('bob'))).toBe(false);
    expect(mayAct(s, { type: 'next' }, who('ann'))).toBe(true);
    expect(mayAct(s, { type: 'next' }, who('host'))).toBe(true);
  });

  it('gives the transport to whoever is placing and the host', () => {
    const s = { ...game(), turn: 1 };
    expect(mayControl(s, who('ann'))).toBe(true);
    expect(mayControl(s, who('host'))).toBe(true);
    expect(mayControl(s, who('bob'))).toBe(false);
    expect(mayControl(null, who('ann'))).toBe(false);
  });

  it('elects the earliest-joined member still online', () => {
    const members = ids.map((id) => ({ id, name: id }));
    expect(electHost(members, new Set(['ann', 'bob']), 'host')).toBe('ann');
    expect(electHost(members, new Set(['bob']), 'host')).toBe('bob');
    // The missing host never re-elects itself, even when presence still lists it.
    expect(electHost(members, new Set(['host', 'bob']), 'host')).toBe('bob');
    expect(electHost(members, new Set(), 'host')).toBeNull();
  });
});

describe('challenge timer', () => {
  const seat = (rules: Settings) => dealGame(rules, ['host', 'ann', 'bob'].map((id) => ({ id, name: id })), CARDS, 7);
  const locked = (rules = timed) => [{ type: 'selectSlot', slot: 0 }, { type: 'lockIn' }].reduce((g, a) => reduce(g, a as Action), seat(rules));
  const pick = (s: GameState) => reduce(s, { type: 'startChallenge', playerId: 'ann' });
  const lockPick = (s: GameState) => reduce(reduce(s, { type: 'selectSlot', slot: 1 }), { type: 'lockChallenge' });

  it('opens at the lock-in with a deadline in host time, and keeps it', () => {
    expect(nextTimer(seat(timed), null, 1000)).toBeNull();
    const s = locked();
    const t = nextTimer(s, null, 1000);
    expect(t).toEqual({ draw: s.draw, ends: 11_000 });
    expect(nextTimer(s, t, 5000)).toBe(t);
  });

  it('is off when the rule is, and in rooms from before it', () => {
    const { challengeTimer: _, ...older } = timed;
    expect(nextTimer(locked(older), null, 0)).toBeNull();
    expect(nextTimer(locked({ ...timed, challengeTimer: 0 }), null, 0)).toBeNull();
    expect(challengesOpen(undefined, 1e12)).toBe(true);
    expect(timeUp(locked(), undefined, 1e12)).toBe(false);
  });

  it('stands still while a challenger picks, then gives the rest what was left, at least 3 s', () => {
    const s = locked();
    const t = nextTimer(s, null, 0);
    const paused = nextTimer(pick(s), t, 4000);
    expect(paused).toEqual({ draw: s.draw, left: 6000 });
    expect(timeUp(pick(s), paused, 60_000)).toBe(false);
    expect(nextTimer(lockPick(pick(s)), paused, 60_000)).toEqual({ draw: s.draw, ends: 66_000 });
    // Picked with a second to go: the others still get three.
    const late = nextTimer(pick(s), t, 9000);
    expect(nextTimer(lockPick(pick(s)), late, 20_000)).toEqual({ draw: s.draw, ends: 23_000 });
  });

  it('closes after a beat once nobody here could still challenge', () => {
    const everyone = new Set(['host', 'ann', 'bob']);
    const s = locked();
    expect(nextTimer(s, null, 0, everyone)).toEqual({ draw: s.draw, ends: 10_000 });
    // Ann is out of chips and Bob's phone is gone.
    const broke = { ...s, players: s.players.map((p) => (p.id === 'ann' ? { ...p, chips: 0 } : p)) };
    expect(nextTimer(broke, null, 0, new Set(['host', 'ann']))).toEqual({ draw: s.draw, ends: BEAT_MS, settled: true });
    // Until presence is known (a host just back from a reload), nobody counts as gone.
    expect(nextTimer(broke, null, 0)).toEqual({ draw: s.draw, ends: 10_000 });
    // Ann challenged; with Bob away, nobody is left once she locks in.
    const paused = nextTimer(pick(s), nextTimer(s, null, 0, everyone), 4000, everyone);
    expect(nextTimer(lockPick(pick(s)), paused, 5000, new Set(['host', 'ann']))).toEqual({ draw: s.draw, ends: 5000 + BEAT_MS, settled: true });
  });

  it('closes challenges at the deadline and goes with the reveal', () => {
    const s = locked();
    const t = nextTimer(s, null, 0)!;
    expect(challengesOpen(t, 9999)).toBe(true);
    expect(challengesOpen(t, 10_000)).toBe(false);
    expect(timeUp(s, t, 9999)).toBe(false);
    expect(timeUp(s, t, 10_000)).toBe(true);
    expect(nextTimer(reduce(s, { type: 'reveal' }), t, 10_000)).toBeNull();
  });
});

describe('roster and wire format', () => {
  const members: Member[] = [
    { id: 'h', name: 'Hana' },
    { id: 'g', name: 'Gus' },
  ];

  it('deals with room ids as player ids', () => {
    const s = dealGame(settings, members, CARDS, 3);
    expect(s.players.map((p) => [p.id, p.name, p.timeline.length])).toEqual([
      ['h', 'Hana', 1],
      ['g', 'Gus', 1],
    ]);
  });

  it('seats a latecomer last with a starting card', () => {
    const s = dealGame(settings, members, CARDS, 3);
    const t = seatLatecomer(s, { id: 'l', name: 'Lou' });
    expect(t.players.map((p) => p.id)).toEqual(['h', 'g', 'l']);
    expect(t.players[2].timeline).toEqual([s.deck[0]]);
    expect(t.deck).toHaveLength(s.deck.length - 1);
    expect(t.turn).toBe(s.turn);
    expect(seatLatecomer(t, { id: 'l', name: 'Lou' })).toBe(t);
  });

  it('numbers a repeated name', () => {
    expect(uniqueName('lou', [{ id: 'a', name: 'Lou' }, { id: 'b', name: 'Lou 2' }])).toBe('lou 3');
    expect(uniqueName('Ann', members)).toBe('Ann');
  });

  it('sends the deck as ids and rebuilds it', () => {
    const room: Room = {
      code: 'ABCD',
      hostId: 'h',
      term: 1,
      seq: 4,
      settings,
      members,
      removed: [],
      game: newGame(settings, ['Hana', 'Gus'], CARDS, 9),
      acks: {},
    };
    const wire = JSON.parse(JSON.stringify(encodeRoom(room))) as WireRoom;
    expect(typeof wire.game!.deck[0]).toBe('string');
    expect(decodeRoom(wire, (id) => BY_ID.get(id))).toEqual(room);
    // A card this build doesn't know is dropped from the deck rather than breaking the room.
    const unknown = { ...wire, game: { ...wire.game!, deck: ['nope', ...wire.game!.deck] } };
    expect(decodeRoom(unknown, (id) => BY_ID.get(id)).game!.deck).toHaveLength(room.game!.deck.length);
  });

  it('orders rooms by term, then the smaller host id, then seq', () => {
    expect(isNewer({ term: 2, seq: 1, hostId: 'z' }, { term: 1, seq: 99, hostId: 'a' })).toBe(true);
    expect(isNewer({ term: 1, seq: 5, hostId: 'a' }, { term: 1, seq: 4, hostId: 'a' })).toBe(true);
    expect(isNewer({ term: 1, seq: 4, hostId: 'a' }, { term: 1, seq: 4, hostId: 'a' })).toBe(false);
    expect(isNewer({ term: 1, seq: 1, hostId: 'a' }, { term: 1, seq: 9, hostId: 'b' })).toBe(true);
    expect(isNewer({ term: 1, seq: 1, hostId: 'a' }, null)).toBe(true);
  });
});

describe('playback sync', () => {
  const tune: Tune = { draw: 3, videoId: 'vid', start: 10, playing: true, pos: 40, at: 100_000 };

  it('runs the host position on from the tune', () => {
    expect(hostPosition(tune, 102_500)).toBe(42.5);
    expect(hostPosition({ ...tune, playing: false }, 102_500)).toBe(40);
  });

  it('lines a backup video up by time past its own start', () => {
    expect(targetPosition(tune, 101_000, { videoId: 'vid', start: 10 })).toBe(41);
    expect(targetPosition(tune, 101_000, { videoId: 'other', start: 0 })).toBe(31);
  });

  it('seeks only past the drift limit', () => {
    const local = { playing: true, videoId: 'vid', start: 10 };
    expect(syncStep({ ...local, time: 41.2 }, tune, 101_000)).toEqual({});
    expect(syncStep({ ...local, time: 41.5 }, tune, 101_000)).toEqual({ seek: 41 });
    expect(syncStep({ ...local, time: 0, playing: false }, tune, 101_000)).toEqual({ seek: 41, play: true });
    expect(syncStep({ ...local, time: 40 }, { ...tune, playing: false }, 101_000)).toEqual({ pause: true });
  });
});

/* ---------- several RoomClients on an in-memory channel ---------- */

const LATENCY = 20;

class Hub {
  private links = new Map<number, { me: Member; events: LinkEvents }>();
  private next = 0;
  /** Messages seen on the channel, for asserting on traffic. */
  log: Msg[] = [];

  connect: Connect = (_code, me, events) => {
    const key = this.next++;
    this.links.set(key, { me, events });
    setTimeout(() => {
      events.status('live');
      this.presence();
    }, LATENCY);
    return {
      send: (msg) => {
        this.log.push(msg);
        const wire = JSON.stringify(msg);
        for (const [k, l] of this.links) if (k !== key) setTimeout(() => l.events.message(JSON.parse(wire)), LATENCY);
      },
      close: () => {
        this.links.delete(key);
        setTimeout(() => this.presence(), LATENCY);
      },
    };
  };

  private presence() {
    const ids = [...new Set([...this.links.values()].map((l) => l.me.id))];
    for (const l of this.links.values()) l.events.presence(ids);
  }
}

function memoryCache(): RoomCache {
  const rooms = new Map<string, WireRoom>();
  return { read: (code) => rooms.get(code) ?? null, write: (room) => void rooms.set(room.code, JSON.parse(JSON.stringify(room))) };
}

function memoryStore(): RoomStore & { rooms: Map<string, WireRoom> } {
  const rooms = new Map<string, WireRoom>();
  return {
    rooms,
    load: async (code) => rooms.get(code) ?? null,
    save: async (room) => void rooms.set(room.code, JSON.parse(JSON.stringify(room))),
  };
}

describe('room client', () => {
  let hub: Hub;
  let store: ReturnType<typeof memoryStore>;
  const devices = new Map<string, RoomCache>();
  const clients: RoomClient[] = [];

  function device(id: string, name: string, create = false): RoomClient {
    if (!devices.has(id)) devices.set(id, memoryCache());
    const c = new RoomClient({
      code: 'TEST',
      me: { id, name },
      connect: hub.connect,
      store,
      cache: devices.get(id),
      cardById: (cid) => BY_ID.get(cid),
      cardsFor: () => CARDS,
      create: create ? { settings } : undefined,
    });
    c.start();
    clients.push(c);
    return c;
  }
  const wait = (ms = 200) => vi.advanceTimersByTimeAsync(ms);
  const game = (c: RoomClient) => c.view.room!.game!;

  beforeEach(() => {
    vi.useFakeTimers();
    hub = new Hub();
    store = memoryStore();
    devices.clear();
  });
  afterEach(() => {
    clients.splice(0).forEach((c) => c.stop());
    vi.useRealTimers();
  });

  async function threeAtTheTable(rules?: Settings) {
    const host = device('h', 'Hana', true);
    const ann = device('a', 'Ann');
    const bob = device('b', 'Bob');
    await wait();
    if (rules) host.setSettings(rules);
    host.startGame(11);
    await wait();
    return { host, ann, bob };
  }

  it('lets players join by hello and seats them in join order', async () => {
    const host = device('h', 'Hana', true);
    const ann = device('a', 'Ann');
    expect(ann.view.status).toBe('connecting');
    await wait();
    const bob = device('b', 'ann');
    await wait();
    for (const c of [host, ann, bob]) {
      expect(c.view.status).toBe('in');
      expect(c.view.room!.members.map((m) => m.name)).toEqual(['Hana', 'Ann', 'ann 2']);
    }
    expect(ann.view.isHost).toBe(false);
    expect(host.view.online).toEqual(new Set(['h', 'a', 'b']));
  });

  it('only lets the host change the rules and deal', async () => {
    const host = device('h', 'Hana', true);
    const ann = device('a', 'Ann');
    await wait();
    ann.setSettings({ ...settings, target: 5 });
    ann.startGame();
    await wait();
    expect(host.view.room!.settings.target).toBe(10);
    expect(host.view.room!.game).toBeNull();
    host.setSettings({ ...settings, target: 5 });
    host.startGame(3);
    await wait();
    expect(game(ann).settings.target).toBe(5);
    expect(game(ann).players.map((p) => p.id)).toEqual(['h', 'a']);
  });

  it('applies a guest intent on the host and shows the guest its move at once', async () => {
    const { host, ann } = await threeAtTheTable();
    host.dispatch({ type: 'selectSlot', slot: 0 });
    host.dispatch({ type: 'lockIn' });
    host.dispatch({ type: 'reveal' });
    host.dispatch({ type: 'next' });
    await wait();
    expect(activePlayer(game(ann)).id).toBe('a');
    expect(ann.dispatch({ type: 'selectSlot', slot: 1 })).toBe(true);
    // Predicted before the host has even heard of it.
    expect(game(ann).slot).toBe(1);
    expect(game(host).slot).toBeNull();
    await wait();
    expect(game(host).slot).toBe(1);
    expect(game(ann).slot).toBe(1);
    expect(host.view.room!.acks.a).toBeGreaterThan(0);
  });

  it('plays a repeated intent only once', async () => {
    const { host } = await threeAtTheTable();
    host.dispatch({ type: 'selectSlot', slot: 0 });
    host.dispatch({ type: 'lockIn' });
    host.dispatch({ type: 'reveal' });
    host.dispatch({ type: 'next' });
    await wait();
    // Ann's skip arriving twice, as after a reconnect: one chip, not two.
    const link = hub.connect('TEST', { id: 'x', name: 'Wire' }, { message() {}, presence() {}, status() {} });
    const skip = { type: 'intent', from: 'a', to: 'h', n: Date.now() + 1e6, action: { type: 'skip' } } as const;
    link.send(skip);
    link.send(skip);
    await wait();
    expect(game(host).players[1].chips).toBe(settings.startChips - 1);
  });

  it('refuses moves that are not this player to make', async () => {
    const { host, ann, bob } = await threeAtTheTable();
    expect(ann.dispatch({ type: 'selectSlot', slot: 0 })).toBe(false);
    // Even a hand-crafted intent is refused by the host.
    const seq = host.view.room!.seq;
    hub.connect('TEST', { id: 'b', name: 'Bob' }, { message() {}, presence() {}, status() {} }).send({
      type: 'intent',
      from: 'b',
      to: 'h',
      n: Date.now() + 1e6,
      action: { type: 'skip' },
    });
    await wait();
    expect(game(host).players[0].chips).toBe(settings.startChips);
    expect(host.view.room!.seq).toBe(seq + 1);
    expect(game(bob).current?.id).toBe(game(host).current?.id);
  });

  it('gives a simultaneous challenge to whoever reached the host first', async () => {
    const { host, ann, bob } = await threeAtTheTable();
    host.dispatch({ type: 'selectSlot', slot: 0 });
    host.dispatch({ type: 'lockIn' });
    await wait();
    expect(ann.dispatch({ type: 'startChallenge', playerId: 'a' })).toBe(true);
    expect(bob.dispatch({ type: 'startChallenge', playerId: 'b' })).toBe(true);
    // Not predicted: nobody sees themselves picking until the host decides.
    expect(game(ann).picking).toBeNull();
    await wait();
    for (const c of [host, ann, bob]) expect(game(c).picking?.playerId).toBe('a');
    expect(bob.may({ type: 'startChallenge', playerId: 'b' })).toBe(false);
    ann.dispatch({ type: 'selectSlot', slot: 1 });
    ann.dispatch({ type: 'lockChallenge' });
    await wait();
    expect(game(bob).challenges).toEqual([{ playerId: 'a', slot: 1 }]);
    expect(bob.may({ type: 'startChallenge', playerId: 'b' })).toBe(true);
  });

  it('stamps the challenge deadline at the lock-in and reveals when it runs out', async () => {
    const { host, ann, bob } = await threeAtTheTable(timed);
    host.dispatch({ type: 'selectSlot', slot: 0 });
    const lockedAt = Date.now();
    host.dispatch({ type: 'lockIn' });
    await wait();
    expect(ann.view.room!.timer).toEqual({ draw: game(ann).draw, ends: lockedAt + 10_000 });
    await wait(9000);
    expect(game(bob).phase).toBe('challenge');
    await wait(1000);
    for (const c of [host, ann, bob]) expect(game(c).phase).toBe('reveal');
    expect(bob.view.room!.timer).toBeNull();
  });

  it('stops the challenge clock while someone picks, and gives the rest at least 3 s after', async () => {
    const { host, ann, bob } = await threeAtTheTable(timed);
    host.dispatch({ type: 'selectSlot', slot: 0 });
    host.dispatch({ type: 'lockIn' });
    await wait(8000);
    ann.dispatch({ type: 'startChallenge', playerId: 'a' });
    await wait(5000);
    // Long past the deadline, but Ann is still picking.
    expect(game(bob).picking?.playerId).toBe('a');
    expect(bob.view.room!.timer).toEqual({ draw: game(bob).draw, left: 2000 - LATENCY });
    ann.dispatch({ type: 'selectSlot', slot: 1 });
    ann.dispatch({ type: 'lockChallenge' });
    await wait(2500);
    expect(game(bob).phase).toBe('challenge');
    expect(bob.may({ type: 'startChallenge', playerId: 'b' })).toBe(true);
    await wait(1000);
    expect(game(bob).phase).toBe('reveal');
    expect(game(bob).outcome?.challenges.map((c) => c.playerId)).toEqual(['a']);
  });

  it('refuses a challenge that reaches the host after the deadline', async () => {
    const { host, bob } = await threeAtTheTable(timed);
    host.dispatch({ type: 'selectSlot', slot: 0 });
    host.dispatch({ type: 'lockIn' });
    await wait();
    // Every clock passes the deadline before the host's own timeout gets its turn.
    vi.setSystemTime(Date.now() + 10_500);
    expect(bob.may({ type: 'startChallenge', playerId: 'b' })).toBe(false);
    // A phone that still showed the button sends it anyway.
    const n = Date.now() + 1e6;
    hub.connect('TEST', { id: 'x', name: 'Wire' }, { message() {}, presence() {}, status() {} }).send({
      type: 'intent',
      from: 'b',
      to: 'h',
      n,
      action: { type: 'startChallenge', playerId: 'b' },
    });
    await wait(100);
    expect(host.view.room!.acks.b).toBe(n);
    expect(game(host).picking).toBeNull();
    expect(game(host).players.find((p) => p.id === 'b')!.chips).toBe(settings.startChips);
    await wait(10_000);
    expect(game(bob).phase).toBe('reveal');
    expect(game(bob).outcome?.challenges).toEqual([]);
  });

  async function twoAtTheTable(rules: Settings) {
    const host = device('h', 'Hana', true);
    const ann = device('a', 'Ann');
    await wait();
    host.setSettings(rules);
    host.startGame(11);
    await wait();
    return { host, ann };
  }

  it('reveals a beat after the only other player has challenged', async () => {
    const { host, ann } = await twoAtTheTable(timed);
    host.dispatch({ type: 'selectSlot', slot: 0 });
    host.dispatch({ type: 'lockIn' });
    await wait();
    expect(ann.view.room!.timer).toEqual({ draw: game(ann).draw, ends: expect.any(Number) });
    ann.dispatch({ type: 'startChallenge', playerId: 'a' });
    await wait();
    ann.dispatch({ type: 'selectSlot', slot: 1 });
    ann.dispatch({ type: 'lockChallenge' });
    await wait(500);
    expect(game(ann).phase).toBe('challenge');
    expect(ann.view.room!.timer).toMatchObject({ settled: true });
    await wait(600);
    for (const c of [host, ann]) expect(game(c).phase).toBe('reveal');
    expect(game(ann).outcome?.challenges.map((c) => c.playerId)).toEqual(['a']);
  });

  it('reveals a beat after the lock-in when nobody has a chip to challenge with', async () => {
    const { host, ann, bob } = await threeAtTheTable({ ...timed, startChips: 0 });
    host.dispatch({ type: 'selectSlot', slot: 0 });
    host.dispatch({ type: 'lockIn' });
    await wait(500);
    expect(game(bob).phase).toBe('challenge');
    expect(bob.view.room!.timer).toMatchObject({ settled: true });
    await wait(600);
    for (const c of [host, ann, bob]) expect(game(c).phase).toBe('reveal');
  });

  it('does not wait on a player whose phone is gone', async () => {
    const { host, ann, bob } = await threeAtTheTable(timed);
    bob.stop();
    await wait();
    host.dispatch({ type: 'selectSlot', slot: 0 });
    host.dispatch({ type: 'lockIn' });
    await wait();
    // Ann is here with a chip, so the clock runs as usual...
    expect(ann.view.room!.timer).toEqual({ draw: game(ann).draw, ends: expect.any(Number) });
    ann.dispatch({ type: 'startChallenge', playerId: 'a' });
    await wait();
    ann.dispatch({ type: 'selectSlot', slot: 1 });
    ann.dispatch({ type: 'lockChallenge' });
    // ...but once she is in, Bob (offline, chips and all) holds nothing up.
    await wait(1200);
    expect(game(ann).phase).toBe('reveal');
  });

  it('leaves the reveal to the players when the timer is off', async () => {
    const { host, ann } = await twoAtTheTable({ ...settings, startChips: 0 });
    host.dispatch({ type: 'selectSlot', slot: 0 });
    host.dispatch({ type: 'lockIn' });
    await wait(12_000);
    expect(game(ann).phase).toBe('challenge');
    expect(ann.view.room!.timer).toBeNull();
  });

  it('drops a prediction the host never confirms', async () => {
    const { host, ann } = await threeAtTheTable();
    for (const a of [{ type: 'selectSlot', slot: 0 }, { type: 'lockIn' }, { type: 'reveal' }, { type: 'next' }] as Action[]) host.dispatch(a);
    await wait();
    host.stop();
    ann.dispatch({ type: 'selectSlot', slot: 1 });
    expect(game(ann).slot).toBe(1);
    await wait(5000);
    expect(game(ann).slot).toBeNull();
  });

  it('brings a reloaded guest straight back as the same player', async () => {
    const { host, bob } = await threeAtTheTable();
    bob.stop();
    host.dispatch({ type: 'selectSlot', slot: 0 });
    await wait();
    const again = device('b', 'Bob');
    // From this device's own copy, before the host has answered.
    expect(again.view.status).toBe('in');
    await wait();
    expect(game(again).slot).toBe(0);
    expect(host.view.room!.members).toHaveLength(3);
  });

  it('hands the room to the earliest member when the host is gone for 10 s', async () => {
    const { host, ann, bob } = await threeAtTheTable();
    host.stop();
    await wait(3000);
    expect(ann.view.hostAway).toBe(true);
    expect(ann.view.isHost).toBe(false);
    await wait(7500);
    expect(ann.view.isHost).toBe(true);
    expect(bob.view.room!.hostId).toBe('a');
    expect(bob.view.room!.term).toBe(2);
    // The active player's phone is gone, so the new host plays for them.
    expect(ann.dispatch({ type: 'selectSlot', slot: 0 })).toBe(true);
    await wait();
    expect(game(bob).slot).toBe(0);
  });

  it('lets a host that comes back after a takeover rejoin as a guest', async () => {
    const { host, ann } = await threeAtTheTable();
    host.stop();
    await wait(11_000);
    expect(ann.view.isHost).toBe(true);
    const back = device('h', 'Hana');
    // Its own copy still says it is the host...
    expect(back.view.isHost).toBe(true);
    await wait();
    // ...until the new host answers its hello.
    expect(back.view.isHost).toBe(false);
    expect(back.view.room!.hostId).toBe('a');
  });

  it('does not take over while the host is only reloading', async () => {
    const { host, ann } = await threeAtTheTable();
    host.stop();
    await wait(4000);
    device('h', 'Hana');
    await wait(8000);
    expect(ann.view.isHost).toBe(false);
    expect(ann.view.hostAway).toBe(false);
  });

  it('resumes from the store when every device reloads without its copy', async () => {
    const { host, ann, bob } = await threeAtTheTable();
    host.dispatch({ type: 'selectSlot', slot: 0 });
    await wait(1500);
    expect(store.rooms.get('TEST')?.seq).toBe(host.view.room!.seq);
    [host, ann, bob].forEach((c) => c.stop());
    devices.clear();
    const ann2 = device('a', 'Ann');
    const bob2 = device('b', 'Bob');
    await wait();
    expect(ann2.view.status).toBe('in');
    expect(game(bob2).slot).toBe(0);
    await wait(11_000);
    expect(ann2.view.isHost).toBe(true);
  });

  it('seats a latecomer in a running game', async () => {
    const { host } = await threeAtTheTable();
    const lou = device('l', 'Lou');
    await wait();
    expect(lou.view.status).toBe('in');
    expect(game(host).players.map((p) => p.id)).toEqual(['h', 'a', 'b', 'l']);
    expect(game(lou).players[3].timeline).toHaveLength(1);
  });

  it('removes a player from the lobby for good', async () => {
    const host = device('h', 'Hana', true);
    const ann = device('a', 'Ann');
    await wait();
    host.remove('a');
    await wait();
    expect(ann.view.status).toBe('removed');
    expect(host.view.room!.members.map((m) => m.id)).toEqual(['h']);
    // Its hellos no longer get it back in.
    await wait(4000);
    expect(host.view.room!.members.map((m) => m.id)).toEqual(['h']);
  });

  it('says so when no room answers', async () => {
    const lost = device('x', 'Xena');
    await wait(7000);
    expect(lost.view.status).toBe('missing');
  });

  it('syncs the guest clock with the host and relays tunes and controls', async () => {
    const { host, ann, bob } = await threeAtTheTable();
    await wait(2000);
    expect(hub.log.some((m) => m.type === 'pong' && m.to === 'a')).toBe(true);
    // Fake timers give every device the same clock, so the estimate lands near zero.
    expect(Math.abs(ann.hostNow() - Date.now())).toBeLessThan(5);
    const tunes: (Tune | null)[] = [];
    ann.onTune((t) => tunes.push(t));
    host.sendTune({ draw: game(host).draw, start: 0, pos: 12, at: host.hostNow(), playing: true, videoId: 'v' });
    await wait();
    expect(tunes.at(-1)?.pos).toBe(12);
    const controls: string[] = [];
    host.onControl((c) => controls.push(c.op));
    bob.control({ op: 'toggle' });
    ann.control({ op: 'restart' });
    host.control({ op: 'seekBy', by: 15 });
    await wait();
    // Bob is not placing; Ann is not either (the host is), so only the host's own press counts.
    expect(controls).toEqual(['seekBy']);
  });
});
