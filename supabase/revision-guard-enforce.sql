-- ═══════════════════════════════════════════════════════════════════════════
-- user_data revision guard: HARD enforcement.   NOT APPLIED. SEPARATE APPROVAL.
-- ═══════════════════════════════════════════════════════════════════════════
-- After this, a write that does not say which revision it read is REFUSED
-- (HTTP 409, 'rev_required'). That is the point: an out-of-date tab or device
-- can no longer overwrite anything. It also means a member still running an
-- old client stops syncing until they reload; their work stays in their
-- browser and is recovered by the new client. Apply only after the recovery
-- path has been verified and the soak window has been judged long enough.
-- Requires supabase/revision-guard.sql to be applied first.

update private.user_data_rev_config set enforce = true;

-- BACK TO SOFT (instant, no deploy):
--   update private.user_data_rev_config set enforce = false;
