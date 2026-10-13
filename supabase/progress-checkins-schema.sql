-- Optional personal ratings belong to the existing UUID-owned user_data row.
-- No change to table grants, membership checks, auth claims or RLS policies.
ALTER TABLE public.user_data
  ADD COLUMN IF NOT EXISTS progress_checkins jsonb NOT NULL DEFAULT '[]'::jsonb;
