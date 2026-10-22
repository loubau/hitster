import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from '../config';
import { STALE_MS } from './cache';
import type { Connect, RoomStore } from './client';
import { newCode } from './code';
import { isWireRoom, type Msg, type WireRoom } from './protocol';

export const roomsConfigured = SUPABASE_URL !== '' && SUPABASE_KEY !== '';

let client: Promise<SupabaseClient> | null = null;

/** Loaded on first use, so table-mode players never download the Supabase client. */
function supabase(): Promise<SupabaseClient> {
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 40 } },
    }),
  );
  client.catch(() => (client = null));
  return client;
}

/** Messages sent before the channel is joined wait here (a reconnect, a slow first join). */
const QUEUE_MAX = 50;
/** A phone back from the background this long reconnects at once instead of waiting on heartbeats. */
const STALE_AFTER_HIDDEN = 10_000;

/**
 * Channels still being taken down, per topic. supabase-js hands back the channel it already has
 * for a topic, even one on its way out, so a quick rejoin has to wait for the old one to go.
 */
const leaving = new Map<string, Promise<unknown>>();

function drop(sb: SupabaseClient, ch: RealtimeChannel): Promise<unknown> {
  const gone = sb.removeChannel(ch).catch(() => {});
  leaving.set(ch.subTopic, gone);
  void gone.finally(() => leaving.get(ch.subTopic) === gone && leaving.delete(ch.subTopic));
  return gone;
}

/** room:<CODE> on Supabase Realtime: broadcast for messages, presence keyed by player id. */
export const connectRealtime: Connect = (code, me, events) => {
  let sb: SupabaseClient | null = null;
  let channel: RealtimeChannel | null = null;
  let joined = false;
  let closed = false;
  let hiddenAt = 0;
  const queue: Msg[] = [];

  const topic = `room:${code}`;
  const open = () => {
    if (!sb || closed) return;
    const old = leaving.get(topic);
    if (old) return void old.finally(open);
    const ch = sb.channel(topic, { config: { broadcast: { self: false }, presence: { key: me.id } } });
    channel = ch;
    // A closed link stays quiet while its channel is still on its way out.
    ch.on('broadcast', { event: 'msg' }, ({ payload }) => !closed && events.message(payload as Msg))
      .on('presence', { event: 'sync' }, () => !closed && events.presence(Object.keys(ch.presenceState())))
      .subscribe((status, err) => {
        if (closed || channel !== ch) return;
        if (status === 'SUBSCRIBED') {
          joined = true;
          // Tracked on every (re)join: presence does not outlive the connection that set it.
          void ch.track({ name: me.name, at: Date.now() });
          events.status('live');
          queue.splice(0).forEach(send);
        } else {
          if (err) console.warn(`[room] channel ${status}`, err);
          joined = false;
          events.status('down');
        }
      });
  };

  const send = (msg: Msg) => {
    if (!channel || !joined) {
      queue.push(msg);
      if (queue.length > QUEUE_MAX) queue.shift();
      return;
    }
    void channel.send({ type: 'broadcast', event: 'msg', payload: msg });
  };

  const reopen = () => {
    if (!sb || !channel) return;
    const old = channel;
    channel = null;
    joined = false;
    events.status('connecting');
    void drop(sb, old).finally(open);
  };

  const onVisible = () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > STALE_AFTER_HIDDEN) reopen();
  };
  document.addEventListener('visibilitychange', onVisible);

  events.status('connecting');
  supabase()
    .then((c) => {
      sb = c;
      open();
    })
    .catch((err) => {
      console.warn('[room] Supabase did not load', err);
      events.status('down');
    });

  return {
    send,
    close() {
      closed = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (sb && channel) void drop(sb, channel);
      channel = null;
    },
  };
};

/** public.rooms: the host's latest room, so it survives everyone reloading. */
export const roomStore: RoomStore = {
  async load(code) {
    const sb = await supabase();
    const { data, error } = await sb.from('rooms').select('state, updated_at').eq('code', code).maybeSingle();
    if (error) throw error;
    if (!data || Date.now() - Date.parse(data.updated_at as string) > STALE_MS) return null;
    return isWireRoom(data.state) ? (data.state as WireRoom) : null;
  },
  async save(room) {
    const sb = await supabase();
    const { error } = await sb
      .from('rooms')
      .upsert({ code: room.code, host_id: room.hostId, state: room, updated_at: new Date().toISOString() });
    if (error) throw error;
  },
};

/** A code nobody has used lately. If the store can't be asked, any code will do. */
export async function freeCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    try {
      if (!(await roomStore.load(code))) return code;
    } catch {
      return code;
    }
  }
  return newCode();
}
