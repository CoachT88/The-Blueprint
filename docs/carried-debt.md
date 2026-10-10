# Carried debt

Known problems that are understood, deliberately not fixed, and recorded so
the next phase inherits the reasoning instead of rediscovering it. An entry
here is a decision, not a backlog wish.

See also `known-timezone-failures.md` for the timezone cluster, which is
tracked separately because it is a suite-wide measurement rather than a
single defect.

---

## Analytics `created_at` is a client clock, stored verbatim

**Found:** pre-deployment hardening, reviewing the `analytics_events`
migration.
**Status:** open, accepted. Not a deployment blocker.

`track()` builds every row with `created_at: new Date().toISOString()`, so the
column's `default now()` never applies and a device with a wrong clock has
that wrong time stored as fact. The buffer also persists offline, so a row can
be inserted days after the moment it describes.

Keeping the client value is the deliberate choice: `created_at` means **when
the event occurred**, and replacing it with `now()` at insert time would
rewrite occurrence time as flush time and destroy the timing of every
offline-buffered event. That trade is worse than the skew.

The fix that loses nothing, approved but not taken in this pass, is one extra
column:

```sql
alter table public.analytics_events
    add column if not exists received_at timestamptz not null default now();
```

Then `created_at` is the client's claim about occurrence and `received_at` is
a trusted server ingestion time. No client change is required either way.

Until that exists, any analysis over `created_at` is subject to device clock
skew, and there is no server-side timestamp to cross-check it against. Treat
narrow time windows and event ordering across members as approximate.

---

## `performedType` reports the scheduled type on a withheld Primary

**Found:** Phase 3C.5, while writing regression coverage for the withheld
Primary path.
**Status:** open. Safe today. Not fixed in 3C.5 because changing it is
outside that phase's boundary.

### What happens

When readiness withholds the Primary (high soreness, the `RECOVER` state),
`captureLaunchPrescription` builds no `exec` block, because Recovery is not
Primary work and freezing the day's Primary dose onto it would hand a girth
circuit to a recovery session. `launchSnapshotFrom` then falls back:

```js
performedType: typeof e.performedType === 'string' && e.performedType
    ? e.performedType : scheduledType,
```

So the snapshot of a Recovery session reports `performedType: 'girth'` while
`session.routineType` is `'recovery'`. The field is named for what is being
performed and, on this one path, does not report it.

### Why it is safe today

Two independent reasons, both verified:

1. **Every execution site compares rather than reads.** `getCurEx`, the round
   and rest readers, `frozenStep` and the resume path all guard on
   `_launchedPrescription.performedType === session.routineType`. With
   `'girth'` against a `'recovery'` session every guard fails closed, which is
   exactly why no girth dose reaches a Recovery session.
2. **It never reaches history.** The block that writes dose and provenance
   onto the session-log entry is gated on `if(_snap && _snap.executionDose)`,
   and `executionDose` is null on this path, so no `performedType`,
   `substituted` flag or dose is recorded. No adherence is invented.

### Why it is still debt

The safety is incidental to the naming. A future reader who treats
`performedType` as a claim about what was performed, instead of comparing it
to `session.routineType`, would be wrong, and would be wrong in the direction
of crediting work that did not happen. The field is load bearing for
fail-closed behaviour precisely because it is inaccurate here, which is a
trap rather than a design.

### Pinned by a test, not left to drift

`tests/e2e/execution-authority.test.js`, in *"AND THE WITHHELD DAY STILL
RECORDS WHICH DAY WAS WITHHELD"*, asserts the real property:

```js
expect(o.performedType).not.toBe(o.routineType);
expect(o.performedType).toBe('girth');
```

That test will fail if someone "fixes" the field without reading this entry,
which is the intent. Fixing it properly means deciding whether the snapshot
should carry an explicit `withheld` or `performed: null`, and auditing all
five comparison sites, rather than changing the fallback in isolation.
