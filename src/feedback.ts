import { SUPABASE_KEY, SUPABASE_URL } from './config';
import type { SetId } from './engine/types';

export type Reason = 'incorrect-info' | 'bad-youtube' | 'dislike';

/** A player's remark about one card; one row of public.feedback (id and created_at come from the database). */
export interface Feedback {
  cardId: string;
  set: SetId;
  reasons: Reason[];
  text: string;
  /** The YouTube video that played for the card, when there was one. */
  videoId?: string;
  /** Whether the card was face up when the remark was made. */
  revealed: boolean;
  mode: 'table' | 'room';
  /** Room mode only. */
  roomCode: string | null;
}

const toRow = (f: Feedback) => ({
  card_id: f.cardId,
  card_set: f.set,
  reasons: f.reasons,
  text: f.text || null,
  video_id: f.videoId ?? null,
  revealed: f.revealed,
  mode: f.mode,
  room_code: f.roomCode,
});

/* Remarks wait here while there is no key yet, or Supabase can't be reached. */
const QUEUE_KEY = 'hitster.feedback.queue';

function readQueue(): Feedback[] {
  try {
    const queue: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
    return Array.isArray(queue) ? queue : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: Feedback[]) {
  try {
    if (queue.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    else localStorage.removeItem(QUEUE_KEY);
  } catch {
    // Storage unavailable; the remark is lost, the game goes on.
  }
}

async function post(f: Feedback): Promise<boolean> {
  if (!SUPABASE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(toRow(f)),
    });
    return res.status === 201;
  } catch {
    return false;
  }
}

let flushing: Promise<void> | null = null;

/** Sends what was queued, oldest first, until Supabase stops taking it. */
export function flushFeedback(): Promise<void> {
  flushing ??= (async () => {
    for (const f of readQueue()) {
      if (!(await post(f))) return;
      // Only the front is removed: a remark queued meanwhile was appended at the end.
      writeQueue(readQueue().slice(1));
    }
  })().finally(() => (flushing = null));
  return flushing;
}

/** Sends a remark, or queues it for later. Resolves true when Supabase took it. */
export async function submitFeedback(f: Feedback): Promise<boolean> {
  if (await post(f)) {
    await flushFeedback();
    return true;
  }
  writeQueue([...readQueue(), f]);
  return false;
}
