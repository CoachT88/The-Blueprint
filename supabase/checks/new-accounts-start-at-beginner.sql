-- READ-ONLY CHECKS for "a new account starts at Beginner".
-- Nothing here writes, creates or changes anything. Counts and column definitions only: no email, no id,
-- no row content. Run each query on its own, on STAGING and on PRODUCTION, and keep the output.
--
-- They mirror src/startingTier.js. The application reads a server row as "never begun" only when EVERY
-- marker column is blank. tests/startingTier.test.js fails if this file and that module name different
-- columns, so the two cannot drift apart unnoticed.

-- ==== QUERY 1 of 2: what a brand-new account's row holds, read from the column definitions =============
-- handle_new_user() inserts only the id, so the value each column holds on a brand-new account IS its
-- default. If any marker column below reads NOT BLANK, the app would read every new account as established
-- and the application change would do nothing on that database (the database default would still apply).
-- A column the table does not have is read by the app as blank, so it is listed as such.
select m.col                                                                  as marker_column,
       c.data_type,
       c.column_default,
       c.is_nullable,
       case
         when c.column_name is null then 'blank (the table has no such column)'
         when c.column_default is null then 'blank (no default: NULL)'
         when c.column_default in ('''''::text', '''''::character varying', '0', 'false', '''[]''::jsonb') then 'blank'
         else 'NOT BLANK: read the default by hand'
       end                                                                    as read_as
  from (values ('week_key'), ('xp_migrated'), ('first_session_date'), ('diff_unlocked_date'), ('total_xp'),
               ('all_time_session_count'), ('session_log'), ('measurements'), ('seen_milestones'),
               ('progress_checkins'), ('progression_ledger'), ('primary_goal'), ('programme'), ('day_plans'),
               ('programme_start_date'), ('pelvic_profile'), ('pelvic_screen_date')) m(col)
  left join information_schema.columns c
         on c.table_schema = 'public' and c.table_name = 'user_data' and c.column_name = m.col
 order by (case when c.column_name is not null
                 and c.column_default is not null
                 and c.column_default not in ('''''::text', '''''::character varying', '0', 'false', '''[]''::jsonb')
                then 0 else 1 end),
          m.col;

-- ==== QUERY 2 of 2: which existing accounts would the app read as "never begun" ========================
-- The app reads a row at Beginner only when every marker is blank: the app has never saved it (week_key and
-- xp_migrated are written on the app's very first load), no tier was ever chosen, and there is no history,
-- goal, plan or pelvic check. The session count alone decides nothing. Each row is read as JSON, so a column
-- the table does not have reads as blank, exactly as the app reads it.
with r as (select to_jsonb(u) as j from public.user_data u),
m as (
  select j,
         coalesce(j->>'difficulty', '') as tier,
         (coalesce(j->>'all_time_session_count', '0') = '0') as zero_sessions,
         (
           not exists (select 1 from (values ('week_key'), ('first_session_date'), ('primary_goal'), ('pelvic_profile'),
                                              ('pelvic_screen_date'), ('programme_start_date')) t(col)
                        where coalesce(j->>t.col, '') <> '')
           and coalesce(j->>'xp_migrated', 'false') = 'false'
           and coalesce(j->>'total_xp', '0') = '0'
           and coalesce(j->>'all_time_session_count', '0') = '0'
           and coalesce(jsonb_typeof(j->'programme'), 'null') = 'null'
           and not exists (select 1 from (values ('session_log'), ('measurements'), ('seen_milestones'), ('progress_checkins'),
                                                 ('progression_ledger'), ('day_plans')) l(col)
                            where not (coalesce(jsonb_typeof(j->l.col), 'null') = 'null'
                                       or (jsonb_typeof(j->l.col) = 'array' and jsonb_array_length(j->l.col) = 0)))
           and (coalesce(jsonb_typeof(j->'diff_unlocked_date'), 'null') = 'null'
                or (jsonb_typeof(j->'diff_unlocked_date') = 'object'
                    and not exists (select 1 from jsonb_each(j->'diff_unlocked_date') e
                                     where not (jsonb_typeof(e.value) = 'null' or e.value = '""'::jsonb))))
         ) as untouched
    from r
)
select
  count(*)                                                                                    as rows_total,
  count(*) filter (where tier = 'beginner')                                                   as tier_beginner,
  count(*) filter (where tier = 'intermediate')                                               as tier_intermediate,
  count(*) filter (where tier not in ('', 'beginner', 'intermediate'))                        as tier_other,
  count(*) filter (where tier = '')                                                           as tier_null_or_empty,
  count(*) filter (where tier = 'intermediate' and zero_sessions)                             as intermediate_never_trained,
  count(*) filter (where tier = 'intermediate' and zero_sessions and not untouched)           as of_which_the_app_has_saved__stay_intermediate,
  count(*) filter (where tier = 'intermediate' and zero_sessions and untouched)               as of_which_never_saved__would_start_at_beginner,
  count(*) filter (where untouched)                                                           as untouched_rows_any_tier,
  count(*) filter (where untouched and tier in ('', 'intermediate'))                          as untouched_rows_the_app_would_move
from m;
