-- Hitster tables. Paste into the Supabase SQL editor once; safe to re-run.
-- The browser uses the publishable key, so row-level security decides what it may do.

-- Remarks players leave about a card (menu > Feedback). Insert-only from the app;
-- read them in the dashboard (Table editor > feedback).
create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  card_id text not null check (char_length(card_id) <= 200),
  card_set text not null check (card_set in ('regular', 'jazz', 'classical')),
  reasons text[] not null default '{}' check (reasons <@ array['incorrect-info', 'bad-youtube', 'dislike']),
  text text check (char_length(text) <= 2000),
  video_id text check (char_length(video_id) <= 32),
  revealed boolean not null default false,
  mode text not null default 'table' check (mode in ('table', 'room')),
  room_code text check (char_length(room_code) <= 8)
);
alter table public.feedback enable row level security;
drop policy if exists "anyone can leave feedback" on public.feedback;
create policy "anyone can leave feedback" on public.feedback
  for insert to anon, authenticated with check (true);

-- Latest snapshot of each multi-device room, written by the host, so a room survives
-- everyone reloading. Live moves travel over Realtime broadcast, not through this table.
create table if not exists public.rooms (
  code text primary key check (code ~ '^[A-Z]{4}$'),
  host_id text not null,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.rooms enable row level security;
drop policy if exists "rooms are readable" on public.rooms;
drop policy if exists "anyone can open a room" on public.rooms;
drop policy if exists "players can update a room" on public.rooms;
create policy "rooms are readable" on public.rooms
  for select to anon, authenticated using (true);
create policy "anyone can open a room" on public.rooms
  for insert to anon, authenticated with check (true);
create policy "players can update a room" on public.rooms
  for update to anon, authenticated using (true) with check (true);

-- Rooms idle for a day are dropped (needs the pg_cron extension: Database > Extensions).
-- select cron.schedule('hitster-rooms-cleanup', '0 4 * * *',
--   $$delete from public.rooms where updated_at < now() - interval '1 day'$$);
