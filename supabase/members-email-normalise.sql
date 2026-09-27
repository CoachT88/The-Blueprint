-- ===========================================================================
-- The Blueprint — normalising legacy member emails
--
-- WHY THIS EXISTS
--
-- Supabase Auth lowercases the address it signs someone in with, and
-- checkMembership() looks the member up with a case-sensitive equality test:
--
--     sb.from('members').select('email').eq('email', user.email)
--
-- So a row stored as Buyer@Example.com is never found for a member signing in
-- as buyer@example.com. They paid, and the app tells them there is no
-- membership for their email. The Ko-fi webhook now lowercases on the way in,
-- which fixes every purchase from here on. Rows written before that change may
-- still be mixed case.
--
-- RUN THESE IN ORDER. Steps 1 and 2 are read-only. Do not skip to step 4.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- STEP 1 (read-only) — what constraints and indexes exist on the column?
--
-- This decides whether step 4 can succeed at all. If email is UNIQUE or the
-- primary key, an update that would produce two identical addresses fails.
-- ---------------------------------------------------------------------------

select
    con.conname                        as constraint_name,
    case con.contype
        when 'p' then 'primary key'
        when 'u' then 'unique'
        when 'c' then 'check'
        when 'f' then 'foreign key'
        else con.contype::text
    end                                as kind,
    pg_get_constraintdef(con.oid)      as definition
from pg_constraint con
where con.conrelid = 'public.members'::regclass
order by con.contype;

-- Indexes too: a unique INDEX enforces uniqueness without being a constraint.
select
    i.relname                          as index_name,
    ix.indisunique                     as is_unique,
    pg_get_indexdef(ix.indexrelid)     as definition
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
where ix.indrelid = 'public.members'::regclass;

-- And the columns, so the remediation in step 3 can keep the right row.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'members'
order by ordinal_position;


-- ---------------------------------------------------------------------------
-- STEP 2 (read-only) — THE COLLISION QUERY
--
-- Which rows would collide once lower(trim(email)) is applied? Every group
-- returned here is two or more rows that normalise to the same address.
--
-- If this returns NO ROWS, step 4 is safe and step 3 is unnecessary.
-- If it returns rows, do not run step 4 yet: read step 3 first.
-- ---------------------------------------------------------------------------

select
    lower(trim(email))   as normalises_to,
    count(*)             as row_count,
    array_agg(email order by email) as existing_variants
from public.members
group by lower(trim(email))
having count(*) > 1
order by row_count desc, normalises_to;

-- How much work step 4 has to do at all. Zero means nothing to normalise.
select count(*) as rows_needing_normalisation
from public.members
where email is distinct from lower(trim(email));


-- ---------------------------------------------------------------------------
-- STEP 3 — remediation, ONLY if step 2 returned rows
--
-- What happens if you skip this and email is UNIQUE: step 4 raises
-- "duplicate key value violates unique constraint" on the first collision.
-- A single UPDATE is one transaction, so it rolls back completely. Nothing is
-- half-normalised and nothing is lost. It simply refuses.
--
-- What happens if email is NOT unique: step 4 succeeds and leaves duplicate
-- rows. Access still works, because checkMembership only asks whether a
-- matching row exists, but the duplicates should be cleaned up anyway.
--
-- These rows are the same buyer with the same address in different case, so
-- keeping either is equivalent for access. Review step 2's output before
-- running this: if the members table has columns worth preserving, such as a
-- created_at or a plan, decide which row to keep on that basis instead.
--
-- Preview first. This shows exactly which rows the delete would remove.
-- ---------------------------------------------------------------------------

select a.ctid, a.email as would_delete, b.email as would_keep
from public.members a
join public.members b
  on lower(trim(a.email)) = lower(trim(b.email))
 and a.ctid > b.ctid;

-- Then, once that list looks right:
--
-- delete from public.members a
-- using public.members b
-- where lower(trim(a.email)) = lower(trim(b.email))
--   and a.ctid > b.ctid;


-- ---------------------------------------------------------------------------
-- STEP 4 — the normalisation itself
--
-- Only after step 2 returns no rows, either because there never were
-- collisions or because step 3 cleared them.
--
-- Left commented so it cannot be run by pasting this file wholesale.
-- ---------------------------------------------------------------------------

-- update public.members
-- set email = lower(trim(email))
-- where email is distinct from lower(trim(email));


-- ---------------------------------------------------------------------------
-- STEP 5 (read-only) — confirm, and stop it recurring
-- ---------------------------------------------------------------------------

-- Should be 0.
select count(*) as still_not_normalised
from public.members
where email is distinct from lower(trim(email));

-- Optional, and worth considering: this makes the database enforce what the
-- webhook now does, so no future path can reintroduce a mixed-case row.
-- Only add it once step 5 returns 0.
--
-- alter table public.members
--   add constraint members_email_is_lowercase
--   check (email = lower(trim(email)));
