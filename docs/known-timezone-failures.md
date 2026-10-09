# Known timezone failures

Status: **pre-existing and open**. Recorded during Phase 3C.5 so the numbers
stop being re-derived from memory every phase. Nothing here was introduced by
3C.5 and nothing here is fixed by it.

CI runs on UTC, where the suite is fully green, so none of this is visible on
a pull request. It appears only when the suite is run under a non-UTC `TZ`.

## What is verified

The failing test sets are **byte identical** at the 3C.5 branch head and at
its base, `main` at `2ff75c90c7e5cb5394bc41d0262983f158fb343d`. The counts
match and so do the names, which is what makes "pre-existing" a measurement
rather than a claim.

| Timezone | Offset | Unit tests failing | Base vs head |
|---|---|---|---|
| `Europe/London` | UTC+0/+1 | 0 | identical |
| `Pacific/Niue` | UTC-11 | 8 | identical |
| `America/New_York` | UTC-4/-5 | 8 | identical |
| `Pacific/Kiritimati` | UTC+14 | 13 | identical |

Reproduce, from a clean tree:

```
TZ=Pacific/Kiritimati npx vitest run
```

To re-confirm the comparison rather than trusting the table:

```
git worktree add --detach <dir> 2ff75c9
# run the same command in both trees and diff the failing test names
```

## The failures

### Behind UTC: the ISO week utilities (8, same set in Niue and New York)

```
getCurrentWeekKey > Dec 30, 2024 key uses ISO year 2025, not calendar year 2024
getISOWeek > Jan 6, 2025 is week 2
getISOWeek > late-December date that belongs to week 1 of the next year
getISOYear > Dec 30, 2024 belongs to ISO year 2025
programme start backfill for existing members > an existing value is never recomputed
shouldResetWeek > same week, different days — no reset
shouldResetWeek > year boundary: Dec 28 (week 52) → Dec 30 (week 1) correctly resets
shouldResetWeek > year boundary: Dec 30 and Jan 1 are the same ISO week — no reset
```

### Ahead of UTC: plan horizon and day keys (13, Kiritimati at UTC+14)

```
one rule across all three consumers > the resolver still calls an unresolved slot unresolved
the horizon never walks backwards > Friday cutover generates the right dates
the horizon never walks backwards > Monday cutover generates the right dates
the horizon never walks backwards > Saturday cutover generates the right dates
the horizon never walks backwards > Sunday cutover generates the right dates
the horizon never walks backwards > Thursday cutover generates the right dates
the horizon never walks backwards > Tuesday cutover generates the right dates
the horizon never walks backwards > Wednesday cutover generates the right dates
the horizon never walks backwards > the dates are contiguous with no gaps
the horizon never walks backwards > the next complete week is always inside the horizon
the record shape is stable > the session-log cross-check stays on the legacy relationship
the session log settles what a scheduled day actually was > REGRESSION: a Recovery-only week cannot complete
the session log settles what a scheduled day actually was > a full mechanical week is allDone
```

## The browser suite

Same method, same answer. `TZ=America/New_York E2E=1 npx vitest run` fails 2
of 1093 at the 3C.5 head, and the identical two tests fail at base `2ff75c9`
with the same names and the same line numbers.

| Timezone | Browser tests failing | Base vs head |
|---|---|---|
| UTC (as CI runs it) | 0 of 1093 | both green |
| `America/New_York` | 2 of 1093 | identical |

```
tests/e2e/first-session.test.js:174
  the first qualifying mechanical session >
  ACCEPTANCE: an established member is not told they are starting

tests/e2e/clock-boundaries.test.js:150
  the gate key is local, not UTC >
  ACCEPTANCE: at UTC+12 the key follows the local date
```

The second is worth reading before anyone treats it as a bug: it is a test
that pins UTC+12 behaviour, so running the suite from a zone behind UTC moves
the ground the fixture stands on. The first is a date fixture that assumes
the member's established history lands on a particular local day.

Note that both are named ACCEPTANCE, and both are therefore load bearing
under UTC. Neither is quarantined or skipped, because they pass in the
configuration CI actually runs.

## Standing hypothesis, not a diagnosis

All three clusters sit where a date is built with `Date.UTC` and then read back
through a local-time accessor, so UTC midnight and local midnight fall on
different calendar days and the fixture's intended day is not the day under
test. The carried `_dayKey()` UTC-midnight debt is the known instance of that
shape in production code.

This has **not** been traced test by test. Until it is, the open question is
the one that matters for members rather than for the suite: how much of this
is fixture arithmetic, which affects nobody, and how much is production code
that would genuinely mis-key a week or a day plan for a member outside UTC.
That triage is its own piece of work and deliberately not part of 3C.5.

## Why it is not fixed here

3C.5 is execution authority: making the stored dose the baseline the app
executes. Date-key correctness across timezones touches week keys, the plan
horizon and the session-log cross-check, which are three different
relationships from the one this phase changed. Folding them in would have
made the phase unreviewable and the mutation gate meaningless.
