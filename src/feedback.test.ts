import { beforeEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({ SUPABASE_URL: 'https://db.test', SUPABASE_KEY: '' }));
vi.mock('./config', () => config);

import { flushFeedback, submitFeedback, type Feedback } from './feedback';

const QUEUE_KEY = 'hitster.feedback.queue';

function note(cardId: string): Feedback {
  return { cardId, set: 'regular', reasons: ['dislike'], text: '', revealed: true, mode: 'table', roomCode: null };
}

const queued = () => (JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as Feedback[]).map((f) => f.cardId);

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  config.SUPABASE_KEY = '';
});

describe('feedback', () => {
  it('queues remarks while there is no key', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await submitFeedback(note('a'))).toBe(false);
    expect(await submitFeedback(note('b'))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(queued()).toEqual(['a', 'b']);
  });

  it('queues remarks Supabase does not take', async () => {
    config.SUPABASE_KEY = 'key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404 }));
    expect(await submitFeedback(note('a'))).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await submitFeedback(note('b'))).toBe(false);
    expect(queued()).toEqual(['a', 'b']);
  });

  it('sends the row and then the queue, oldest first', async () => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([note('old-1'), note('old-2')]));
    config.SUPABASE_KEY = 'key';
    const fetch = vi.fn().mockResolvedValue({ status: 201 });
    vi.stubGlobal('fetch', fetch);
    expect(await submitFeedback({ ...note('new'), videoId: 'abc', text: 'Wrong year' })).toBe(true);

    const rows = fetch.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(rows.map((r) => r.card_id)).toEqual(['new', 'old-1', 'old-2']);
    expect(rows[0]).toEqual({
      card_id: 'new',
      card_set: 'regular',
      reasons: ['dislike'],
      text: 'Wrong year',
      video_id: 'abc',
      revealed: true,
      mode: 'table',
      room_code: null,
    });
    expect(fetch.mock.calls[0][0]).toBe('https://db.test/rest/v1/feedback');
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ apikey: 'key', Authorization: 'Bearer key', Prefer: 'return=minimal' });
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
  });

  it('stops flushing at the first failure and keeps the rest', async () => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([note('a'), note('b'), note('c')]));
    config.SUPABASE_KEY = 'key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ status: 201 }).mockResolvedValue({ status: 503 }));
    await flushFeedback();
    expect(queued()).toEqual(['b', 'c']);
  });
});
