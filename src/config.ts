/* Public Supabase project settings. The publishable key is meant to ship to browsers;
   row-level security (supabase/schema.sql) limits what it can do. */
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? 'https://yqdwrmibbftvyrbbadkb.supabase.co';
export const SUPABASE_KEY: string = import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_9gIJW2hxVsZgly3PstXM9w_SXm77fjA';
