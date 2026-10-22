-- Rooms untouched for 48 hours are deleted, checked every hour.
-- The app already treats a room idle for 12 hours as over (STALE_MS in src/room/cache.ts).
create extension if not exists pg_cron with schema pg_catalog;

-- Scheduling under an existing name replaces that job, so this is safe to run again.
select cron.schedule(
  'hitster-rooms-cleanup',
  '17 * * * *',
  $$delete from public.rooms where updated_at < now() - interval '48 hours'$$
);
