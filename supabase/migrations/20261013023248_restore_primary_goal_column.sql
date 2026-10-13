-- Restore the existing goal field required by the application's save payload.
-- Adding it prevents the schema fallback from dropping program and day-plan writes.
-- Existing training history and progress are untouched.
alter table public.user_data add column if not exists primary_goal text default '';
