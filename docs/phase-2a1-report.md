# Phase 2A.1 report

Branch `claude/deploy-edge-function-U4G2J`, commit `d15c693`, based on `main` at `2160d67`.

Scope delivered: the evidence and claims pass, plus the three pure modules and
their tests. Nothing in `app/index.html` calls the modules yet, and no screen
was restructured.

---

## 1. Files changed

| File | Status | What |
|---|---|---|
| `app/index.html` | modified | 51 string literals. No identifiers, conditions, numeric constants or DOM structure changed. |
| `src/nextBestAction.js` | new | The resolver. Pure. |
| `src/sessionDuration.js` | new | The duration estimator. Pure. |
| `src/weekCompletion.js` | new | Week completion. Pure. |
| `tests/nextBestAction.test.js` | new | 55 tests |
| `tests/sessionDuration.test.js` | new | 35 tests |
| `tests/weekCompletion.test.js` | new | 12 tests |
| `docs/phase-2a1-report.md` | new | this file |

`git diff app/index.html` is 55 insertions and 54 deletions, and every changed
line is inside a quoted string or an HTML text node. Verified by filtering the
diff for lines that are not string literals: the result is empty.

---

## 2. Claims table

Classified against the four tier hierarchy, then marked KEEP / SOFTEN /
REMOVE / NEEDS SOURCE. Grouped by what was wrong with them rather than by
file position, because the same claim appears in several places and should
move in all of them at once.

### REMOVE

| Where | Claim | Evidence | Now |
|---|---|---|---|
| Pre-Flight card | "FALLING BELOW 3L DAILY creates brittle, tear-prone tissue" | INSUFFICIENT. No threshold at which ordinary hydration becomes a tissue safety risk. | "Train well hydrated. Top up through the day rather than drinking a lot right before you start." |
| Manual, Tips | "Dehydrated collagen is brittle and resistant to expansion. Hit 3L daily" | INSUFFICIENT for the brittleness claim; 3L is a product target, not a safety line. | Reframed as a daily target the app tracks, explicitly "not a line you cross into danger". |
| `COACH_TIPS` hydration | "3L a day isn't optional" | INSUFFICIENT as stated. | "a simple habit to hold, not because something goes wrong the moment you fall short". |
| Guided tour, hydration stop | "dehydrated tissue does not respond" | INSUFFICIENT. | "Staying hydrated is basic upkeep for everything else here." |
| `getHydrationWarning()` | "hydrated tissue expands, dry tissue tears" | INSUFFICIENT. | Clause removed; the 2L prompt stands. |
| `COACH_TIPS` posture | "Posture affects blood flow directly… a direct vascular intervention… affects genital blood flow every minute" | SUPPORTIVE at best for general circulation; INSUFFICIENT for the genital-specific direct claim. | Kept as a hip and back habit, with the direct effect explicitly stated as not established. |
| `RECOVERY_META[4]`, `ROUTINES.recovery[4].detail`, Manual | "A deep squat physically widens the space your tissue hangs from" / "physically opens the pelvic outlet" | INSUFFICIENT. A stretch does not change pelvic bony anatomy. | "A deep hip and groin stretch. It will not change your anatomy." |

### SOFTEN

| Where | Claim | Evidence | Now |
|---|---|---|---|
| `RECOVERY_META[1]` | "Without this, tightness caps your gains" | SUPPORTIVE. Pelvic floor tension is a real clinical entity; "caps gains" is not a measured outcome. | "Persistent tightness is worth working on in its own right." |
| `RECOVERY_META[3]` | "Motor control at low intensity translates directly to sustained EQ" | SUPPORTIVE. | "may help you hold position through a longer session". |
| `RECOVERY_META[7]`, Manual Butterfly | adductors "directly linked to pelvic floor tension" | SUPPORTIVE. Anatomically adjacent; the causal link is not established. | "sit close to the pelvic floor and commonly get tight from sitting… plausible rather than proven". |
| `RECOVERY_META[5]`, `[6]`, Manual, exercise details | "Fastest way to turn off a tight pelvic floor" / hip rotators "restrict tissue mobility" | SUPPORTIVE for hip mobility; INSUFFICIENT for the superlative and for the downstream claim. | "A quick way to take tension out of the hips and pelvic floor"; hip work framed as general hip care. |
| `RECOVERY_META[2]` | "Collagen remodels during rest, a released floor means better overnight adaptation" | SUPPORTIVE. | "a low cost way to finish the day less tense". |
| `COACH_TIPS` inflammation | diet "directly impairs vascular function and testosterone production" | MODERATE for the association, INSUFFICIENT for same-day causation. | "associated with worse vascular and metabolic health over time… cumulative rather than same day". |
| `COACH_TIPS` zinc | "Most men are chronically low" | INSUFFICIENT. Not true of men eating a typical Western diet. | Claim dropped; deficiency association kept; added that topping up when not deficient is not known to help. |
| `COACH_TIPS` magnesium | "Most men are deficient" | INSUFFICIENT as stated. | "Intake below the recommended amount is common." |
| `COACH_TIPS` L-citrulline | "Watermelon, spinach, and beets contain it naturally" | Factually loose: beets and greens supply nitrate, not citrulline. | Corrected to name the two routes separately. |
| `COACH_TIPS` nitric oxide | "declines about 10% per decade after 30" | NEEDS SOURCE. | Figure removed; the direction of travel kept. |
| `COACH_TIPS` cold/heat | "trains your arterial walls to open wider on demand. The mechanism behind stronger EQ." | INSUFFICIENT. | "Whether that cycling produces any lasting change in erection quality has not been shown." |
| `COACH_TIPS` collagen at night | "all reduce collagen synthesis and slow your progress" | SUPPORTIVE. | "mechanistic rather than measured, but the sleep itself is not optional". |
| `COACH_TIPS` stress | "One stressful week can set back weeks of progress" | INSUFFICIENT for the quantity; the underlying link is well supported. | Quantity dropped, the established link stated plainly. |
| `COACH_TIPS` sitting | "That one habit protects more than most supplements" | Rhetorical. | "it is better evidenced than most supplements" (true, and lower key). |
| `COACH_TIPS` morning EQ | "If they're strong, your arteries are healthy and dilating properly" | SUPPORTIVE. Overstates a rough screen. | "a rough read on vascular and nerve function… worth raising with a doctor". |
| `COACH_TIPS` rest days | "upregulating hormone receptors, and improving vascular tone" | INSUFFICIENT specificity. | "Adaptation happens between sessions, not during them." |

### KEEP, with the evidence stated

| Where | Claim | Evidence | Now |
|---|---|---|---|
| `RECOVERY_META[0]`, Manual Kegels | pelvic floor training improves blood flow and EQ | **STRONG DIRECT** for pelvic floor muscle training in ED and PE, conditional on the floor not being hypertonic. | Stated as "reasonable evidence behind it for erectile function and ejaculatory control, provided the floor is not already holding too much tension." Strengthened, not softened. |
| `COACH_TIPS` pelvic floor relaxation | hypertonic floors are common and squeezing makes them worse | MODERATE / EMERGING DIRECT. | Kept; "chokes off blood flow to the genitals" removed as unsupported. |
| `COACH_TIPS` testosterone and sleep | "Less than 6 hours cuts production by up to 15%" | **STRONG DIRECT**, from controlled sleep restriction work in healthy young men. | Kept, now attributed: "in controlled studies a week of short sleep lowered daytime levels… by roughly 10 to 15 percent". |

### Aerobic exercise

Locked wording used verbatim in `COACH_TIPS`:

> Regular aerobic exercise has been shown to improve erectile function,
> particularly in men experiencing erectile difficulties.

Followed by "That is a finding across groups rather than a promise to any one
man". The separate walking tip was rewritten to point at the same evidence
instead of making its own pudendal-artery claim.

### Breathwork

Reclassified. Was written as a direct blood-flow mechanism; is now:

> Diaphragmatic breathing is a dependable way to drop tension before a
> session, and there is emerging evidence for it as one part of combined
> rehabilitation for premature ejaculation. On its own, treat it as a
> relaxation tool rather than a treatment.

No breathwork exercise was added to the library. See item 8 for the audit you
asked for.

### NEEDS SOURCE, resolved by removing the number

All in `WARMUP_TIPS` and the Manual's warmup tip. Each figure was unsourced
and none of them was carrying the argument.

| Claim | Now |
|---|---|
| "increasing ligament elasticity by up to 40%" | "Moist heat carries thermal energy into tissue more evenly than dry heat." |
| "Core tissue temperature takes 8–10 minutes… deep ligament structures stay cold until minute 8" | "Surface warmth arrives long before deep tissue does… Ten minutes is the standard this protocol uses." |
| "Athletes who skip warmup plateau 3–4× faster" (twice: carousel and Manual) | "Warming up before loading tissue is standard practice across every training discipline, and it costs ten minutes." |
| "This is why consistent warmers gain faster" | "the cheapest thing you can do to arrive at a session prepared". |
| "Work it cold and micro-tears accumulate" | "Working cold is where avoidable strains come from." |

### Soreness and pain

| Where | Was | Now |
|---|---|---|
| Soreness modal, high | "High soreness is a stop signal. Training today risks injury." | "High muscle soreness. Mechanical training is on hold today… Soreness is not an injury, but it is a signal worth respecting." |
| Soreness modal, moderate | "pelvic floor work and hip stretches will accelerate healing" | "keeps you moving without adding mechanical stress". |
| Manual, soreness check-in | "it creates scar tissue that limits future adaptation" | "does not speed anything up, and backing off for a day costs you very little". |
| Manual, HQ chapter | "This is not optional coaching, overtrained tissue does not adapt" | "Take that recommendation. Hard training on top of real soreness is not where progress comes from." |

All three modal strings now say "muscle soreness". A new paragraph in the
Manual's safety chapter states what the scale is not measuring:

> The soreness scale is asking about muscle soreness, the dull ache that
> follows work. It is not asking about sharp pain, electric or stinging
> sensations, unusual joint pain or anything nerve-like. Those are not a
> volume problem. Stop the exercise, and get them looked at by a professional
> if they persist or recur.

Concise, no diagnosis, no prescribing around it. The Ready screen will carry
the same distinction in 2A.3.

### Rest framing

| Where | Was | Now |
|---|---|---|
| Rest day CTA subtitle | "Training is locked today. This takes you to the Recovery Protocol, which is how you actually grow." | "Rest is on the schedule today. This takes you to the Recovery Protocol." |
| Blackout screen | "Training is locked today. Access Recovery Protocol only" | "Rest day. Recovery Protocol is what is on offer." |
| Manual heading | "Rest Day Enforcement" | "Rest days", and the body now says rest "is part of the programme, not a gap in it". |

### Em dashes

No em dash appears in any sentence written for this pass. Eight changed lines
still contain one, all pre-existing and none in new prose: the Manual's
`**Name** — description` bullet separator, the exercise title "Deep Squat —
Malasana", the carousel title "Why 10 Minutes — Not 5", and "Hinge forward at
the hips — not the lower back". Normalising the separator would mean editing
every Manual bullet including unedited ones, which is outside this scope.

---

## 3. Resolver API

```js
nextBestAction(input) -> result
```

Pure. No DOM, no globals, no clock of its own. Every table it needs is passed
in, so there is one definition of `GOALS`, `DAY_TYPES` and
`CONTRACTION_RECOVERY_IDX` and no second copy to drift.

**Input**

| Field | Meaning |
|---|---|
| `dataLoaded` | has persisted state actually loaded, not merely defaulted |
| `now` | `Date`. Required. |
| `goals` | the `GOALS` table |
| `goalKey` | `persisted.primaryGoal` |
| `dayTypes` | the `DAY_TYPES` table, for labels inside reasons |
| `schedule` | `persisted.schedule`, seven entries by `Date#getDay()` |
| `completedDays` | `persisted.completedDays`, seven booleans |
| `sessionDraft` | the unfinished session, or null |
| `soreness` | `'' \| 'none' \| 'mild' \| 'moderate' \| 'high'` |
| `pelvicProfile` | `'' \| 'tight' \| 'standard'` |
| `firstSessionDate` | for the deload rule |
| `recoveryPlan` | recovery indices a Recovery prescription would use |
| `contractionIndices` | `CONTRACTION_RECOVERY_IDX` |
| `estimateMinutes` | optional `(mission, opts) => number` |

**Output**

| Field | Meaning |
|---|---|
| `state` | one of the seven |
| `mission` | what to run, or null |
| `reason` | one sentence, member facing |
| `duration` | minutes, or null when the prescription is not a session |
| `modifiers` | `{ deload, tightFloor, moderateSoreness, pelvicScreenRequired }` |
| `overrideAllowed` | may the UI offer a path away from this prescription |
| `optional` | the quiet secondary offer, or null |
| `changes` | short sentences naming what is different from a normal day |
| `prepare` | `'loading' \| 'goal' \| 'pelvic-screen' \| null` |
| `intendedMission` | what was going to be prescribed before a gate intervened |
| `recoveryPlan` | the indices this prescription may actually use |

`optional` is `{ mission: 'recovery', label: 'Active Recovery', duration,
exercises, countsTowardWeek: false }`. Never "Bonus Work", and
`countsTowardWeek` is false by construction.

`overrideAllowed` is false for `PREPARE`, for `REST`, and for `RECOVER`
reached through high soreness.

Also exported and separately tested: `isDeloadWeek`, `hasPelvicScreen`,
`isPelvicSpecific`, `allowedRecoveryPlan`, `STATES`, `TRAINING_MISSIONS`.

---

## 4. Precedence table

One visible ladder, first match wins. Safety above programming, programming
above preference.

| # | Condition | State | Note |
|---|---|---|---|
| 1 | `!dataLoaded` | `PREPARE` | `prepare: 'loading'` |
| 2 | a session draft exists | `RESUME` | finishing beats starting |
| 3 | no recognised goal | `PREPARE` | `prepare: 'goal'` |
| 4 | `completedDays[today]` | `COMPLETE` | never manufacture a second task |
| 5 | `soreness === 'high'` | `RECOVER` | `overrideAllowed: false` |
| 6 | `schedule[today] === 'rest'` | `REST` | rest is a prescription |
| 7 | `soreness === 'moderate'` | `MODIFIED` | `-1` set, `x0.6` duration |
| 8 | `schedule[today]` is length/girth/stamina | `TRAIN` | the ordinary case |
| 9 | schedule missing or unreadable | `TRAIN` | falls back to `GOALS[goal].mission` |

Then, as a post-pass, the pelvic screener gate, and then the modifiers
`deload` and `tightFloor`, neither of which changes the state.

**The pelvic gate.** Applied after the ladder, because what it should do
depends on what was prescribed:

- on a `TRAIN` or `MODIFIED` prescription that is pelvic specific, it becomes
  `PREPARE` with `prepare: 'pelvic-screen'` and `intendedMission` set;
- on `RECOVER` or `REST` it does not change the state. It sets
  `pelvicScreenRequired`, narrows `recoveryPlan` to the non-contraction
  subset, and pushes the screener into `changes`.

See item 8 for why, and for the sign-off this needs.

---

## 5. Tests added

102 new tests in three files.

**`tests/nextBestAction.test.js`** (55). All fifteen required cases, plus:
every adjacent pair in the ladder exercised with both conditions true; one
case with every condition true at once; the gate's three outcomes; duration
wired to the real estimator; and hygiene assertions that no reason contains an
em dash, that no reason implies soreness is an injury, that the moderate
soreness reason never cites research or a percentage, and that the resolver is
deterministic and reads no clock of its own.

**`tests/sessionDuration.test.js`** (35). Every mission at the relevant
difficulties, deload on and off, the soreness modifier, stacking, empty and
partial recovery selections, unknown missions and missing tables. Plus a
drift-guard block that asserts `DIFFICULTIES`, `GIRTH_CIRCUIT`, every
per-exercise `sets`/`duration`, the rest formula, the `setIndex < ex.sets`
guard and the three `getCurEx()` branches are still exactly what the fixtures
copy. If `index.html` moves, these fail rather than the estimate silently
lying.

**`tests/weekCompletion.test.js`** (12). The denominator, rest days not
counting as failures, a flag on a rest day not inflating the numerator,
all-rest weeks, malformed inputs, and that only an exact `true` counts.

### Mutations

Eleven faults reintroduced, each caught by a named test, each reverted.

| Mutation | Caught by |
|---|---|
| high soreness becomes overridable | "high soreness, after Ready has supplied it" |
| rest day outranks high soreness | "5 over 6" |
| high soreness outranks a finished day | "4 over 5" |
| malformed schedule falls back to rest | "an unknown or malformed schedule falls back to the goal mission" |
| pelvic gate stops narrowing the plan | "a tight floor loses contraction work" |
| pelvic gate never fires for an unscreened member | "pelvic specific prescription and an unscreened member" |
| rest runs after the last set too | "rests between sets, not after the last one" |
| recovery is scaled by difficulty | "recovery runs with no warmup, no difficulty and no deload" |
| rest days count toward the weekly target | "counts scheduled non-rest sessions as the target" |
| extra work on a rest day counts | "a flag set on a rest day does not inflate the numerator" |
| girth deload dropped | "deload shortens the work but not the inter-round rest" |

---

## 6. Test results

```
npm test            11 files   343 passed   0 failed   1.62s
npm run test:e2e    25 files   249 passed   0 failed   208.80s
```

The browser suites matter here beyond regression: they drive the real
`index.html`, including the guided tour geometry and the Manual, so they would
catch a claims edit that broke markup or a tour stop.

---

## 7. Existing behaviour the module cannot represent safely

1. **Two sessions on the same day.** `completedDays` is one boolean per
   weekday index, so a second session collapses into the first and a session
   on a scheduled rest day cannot be counted at all. Documented in
   `weekCompletion.js`, not solved; fixing it is a persisted-shape change and
   a migration.

2. **The soreness modal's Dismiss button.** `showSorenessWarning()` still
   offers "Go to Recovery" and "Dismiss" after a high-soreness report. The
   copy no longer claims injury, but the structure is still a safety
   recommendation beside a button to disregard it, which is what decision 3
   rules out. The resolver returns `overrideAllowed: false`; the modal does
   not read the resolver yet. This is a 2A.3 wiring item and I did not change
   the modal's structure under a strings-only pass.

3. **The streak and rest days.** `getCurrentStreak()` breaks the streak on any
   day without a session, including scheduled rest days. That contradicts both
   the week completion model and the new rest framing: a member who follows
   the programme exactly loses their streak twice a week. Out of scope here
   (changing streak logic is on the do-not list) but it will read as a
   contradiction the moment the Today card shows both numbers.

4. **Mild soreness.** The resolver treats `mild` as no modifier, matching
   current behaviour, while the existing modal still pops a Recovery
   suggestion for it. Deliberately left aligned with today's behaviour rather
   than quietly introducing a fourth rule.

5. **Malformed schedules.** `getScheduledType()` returns `'rest'` for a
   missing or unrecognised slot, so a corrupt array currently reads as a week
   off. The resolver instead falls back to the goal's mission (rule 9), which
   is the approved precedence but **is a behavioural difference** from what
   ships today. In practice `normaliseSchedule()` repairs bad slots on load,
   so the window is narrow.

6. **Recovery volume.** The estimator applies neither difficulty nor deload to
   recovery, because `getCurEx()` does not. So a member on Beginner and a
   member on Elite get the same 22-minute full recovery session. That is
   current behaviour faithfully mirrored, not a decision made here.

7. **`EX_EXPERIENCE` is empty.** The per-exercise override table exists and is
   `{}`. The estimator ignores it. If it is ever populated, the estimator
   needs the same branch `applyDifficulty()` has.

---

## 8. Needs reviewer approval before 2A.2

1. **The pelvic gate's placement on `RECOVER` and `REST`.** Decision 2 reads
   as: pelvic-specific prescription plus unscreened member equals `PREPARE`.
   Taken literally, a member who has just reported high soreness and is routed
   to Recovery would be met with a six-question screener instead of something
   to do. I implemented the gate so that it becomes `PREPARE` only on a
   training prescription; on `RECOVER` and `REST` it narrows `recoveryPlan`,
   sets `pelvicScreenRequired` and names the screener in `changes`, so the
   removal is visible and the screener is one tap away without being the only
   way forward. This is a deliberate departure from the literal reading and
   needs a yes or a correction.

2. **The `PREPARE` branch is currently unreachable in production data.** No
   scheduled day type is pelvic specific, so rule 7's `PREPARE` outcome only
   fires for a goal whose `mission` is `recovery`, which no shipped goal has.
   It is fully tested and dormant, ready for 2B. Confirm that is the intent
   rather than a sign the gate belongs somewhere else.

3. **Rule 9 changes behaviour for a malformed schedule** (item 7.5 above):
   today it reads as rest, the approved ladder makes it a goal-default train
   day. Flagging because it is a real change, small blast radius.

4. **Breathwork audit, as requested.** A dedicated diaphragmatic breathing
   exercise would fit the tight-profile and recovery path, and partly fills a
   real gap: of the four pelvic exercises, two are contraction work that a
   tight-profile member never sees, which leaves them two. It is trivial to
   instruct and needs no equipment. Against: `ROUTINES.recovery[2]` (Pelvic
   Floor Release) already uses breath and gravity, and the rest overlay
   already runs box breathing, so a standalone exercise may be a third copy of
   the same thing rather than a new capability. My recommendation is to widen
   `[2]` rather than add a ninth exercise, but this is explicitly deferred and
   nothing was changed.

5. **Soreness modal restructuring** (item 7.2). Removing the Dismiss path
   after a high-soreness report is a structural change to a shipped modal. It
   belongs in 2A.3, but confirm it is wanted there rather than sooner.

6. **The `overrideAllowed: false` on `REST`.** Rest days currently lock Length
   and Girth via `isBlackoutDay()`, so the resolver reports no override. That
   is faithful to today's behaviour, but decision 10 asks for rest not to feel
   punitive, and a hard lock is the most punitive part. Flagging in case the
   intent is for rest to become a strong default rather than a lock.
