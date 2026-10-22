import type { RoomCache } from './client';
import { isWireRoom, type WireRoom } from './protocol';

/** Rooms older than this are history: their code may belong to someone else's room by now. */
export const STALE_MS = 12 * 60 * 60 * 1000;

const key = (code: string) => `hitster.room.${code}.state`;

/** The last room this browser saw, per code, in localStorage. */
export const localRoomCache: RoomCache = {
  read(code) {
    try {
      const saved = JSON.parse(localStorage.getItem(key(code)) ?? 'null') as { at: number; room: WireRoom } | null;
      if (!saved || Date.now() - saved.at > STALE_MS || !isWireRoom(saved.room)) return null;
      return saved.room;
    } catch {
      return null;
    }
  },
  write(room) {
    try {
      localStorage.setItem(key(room.code), JSON.stringify({ at: Date.now(), room }));
    } catch {
      // Storage full or unavailable: a reload asks the host instead.
    }
  },
};
