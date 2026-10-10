-- ===========================================================================
-- The Blueprint — close the public members lookup
--
-- DO NOT RUN THIS YET.
--
-- The live policy is still:
--     "Allow email check"  SELECT  USING (true)
-- which lets any caller read every row, and therefore enumerate the email
-- address of every person who has ever bought. That was left open on purpose,
-- because the DEPLOYED client still gates membership with
--     select ... from members where email = <signed-in email>
-- and removing the policy before the new client is live would lock every
-- member out of the app.
--
-- THE ORDER IS NOT OPTIONAL:
--   1. deploy the client that calls claim_membership()
--   2. verify a real member signs in on production
--   3. verify a real NON member is still refused
--   4. only then run this file
--
-- Section 0 is a gate, not a formality: it fails loudly if the old lookup is
-- still being used. Idempotent, and safe to re-run once applied.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. GATE. Run this alone and read it before section 1.
-- ---------------------------------------------------------------------------

-- Every policy currently on members, so there is a record of what is being
-- replaced and nothing is removed that was not seen first.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'members'
order by policyname;

-- How far the cutover has actually got. The old client cannot work for a row
-- whose user_id is null, and the new client cannot be verified until some are
-- claimed, so this is the honest progress measure.
select
    count(*)                                   as entitlements,
    count(user_id)                             as claimed,
    count(*) - count(user_id)                  as unclaimed
from public.members;

-- The RPC must exist and be callable by a signed-in member BEFORE the policy
-- goes, or the new client has nothing to fall back on.
select
    p.proname,
    pg_get_function_identity_arguments(p.oid)                 as arguments,
    p.prosecdef                                               as is_security_definer,
    p.proconfig                                               as config,
    has_function_privilege('authenticated', p.oid, 'execute') as auth_can_execute,
    has_function_privilege('anon',          p.oid, 'execute') as anon_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'claim_membership';
-- REQUIRED before proceeding: auth_can_execute true. anon_can_execute should
-- be false: the function needs auth.uid() and an anonymous caller has none,
-- so granting it buys nothing and widens the surface.


-- ---------------------------------------------------------------------------
-- 1. Remove the public lookup
--
-- With RLS enabled and no SELECT policy for a role, SELECT is denied. That is
-- the desired end state for members: entitlement is answered by
-- claim_membership(), which is security definer and reads auth.uid(), so no
-- member ever needs to read the table directly.
-- ---------------------------------------------------------------------------

drop policy if exists "Allow email check" on public.members;

-- Belt and braces: the table grants, not just the policy. A default Supabase
-- project grants broad table privileges to anon and authenticated, and the
-- policy is then the only thing standing in the way.
revoke all on public.members from anon;
revoke all on public.members from authenticated;

-- service_role keeps full access: the Ko-fi webhook writes entitlements and
-- the claim function runs as its owner.


-- ---------------------------------------------------------------------------
-- 2. OPTIONAL, and only if something still needs a direct read
--
-- Prefer leaving this commented. The point of the cutover is that a member
-- never reads this table: they ask claim_membership() about themselves. If a
-- future surface genuinely needs it, this is the narrow shape, scoped to the
-- caller's OWN row and nothing else. It still cannot enumerate, because a
-- member cannot see a row whose user_id is not theirs.
--
-- drop policy if exists "members read own entitlement" on public.members;
-- create policy "members read own entitlement"
--     on public.members
--     for select
--     to authenticated
--     using (user_id = auth.uid());
-- grant select on public.members to authenticated;
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 3. Checks, read-only
-- ---------------------------------------------------------------------------

-- RLS on, and the permissive public SELECT gone.
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename = 'members';

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'members'
order by policyname;
-- Expect NO policy with qual `true` for select.

-- Expect false for every column here except the service_role line.
select
    has_table_privilege('anon',          'public.members', 'select') as anon_select,
    has_table_privilege('anon',          'public.members', 'insert') as anon_insert,
    has_table_privilege('authenticated', 'public.members', 'select') as auth_select,
    has_table_privilege('authenticated', 'public.members', 'insert') as auth_insert,
    has_table_privilege('authenticated', 'public.members', 'update') as auth_update,
    has_table_privilege('authenticated', 'public.members', 'delete') as auth_delete,
    has_table_privilege('service_role',  'public.members', 'select') as service_select;

-- The entitlement counts must not have moved. This file changes permissions,
-- never data.
select count(*) as entitlements, count(user_id) as claimed from public.members;


-- ---------------------------------------------------------------------------
-- 4. Rollback, and the one thing not to do
--
-- If members are locked out after this, the cause is the CLIENT not reaching
-- claim_membership(), not the policy. Restoring the open policy hides that by
-- re-exposing every purchaser's email, so it is a last resort and not a fix:
--
--   create policy "Allow email check" on public.members for select using (true);
--
-- Check in this order instead:
--   1. is the deployed client actually calling the RPC (network tab)
--   2. does the RPC return true for that member's UUID
--   3. is that member's row claimed at all, or still user_id null
--
-- A member whose row is unclaimed and whose email no longer matches cannot
-- self-serve: that is a data question, answered by attaching the right
-- user_id to the right entitlement, not by reopening the table.
-- ---------------------------------------------------------------------------
