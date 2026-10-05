# Last Longer: evidence record and design

Phase 3S. **Design document. Nothing here is implemented.**

Status: **frozen for implementation planning.** Rulings P1 to P11 locked.
Three work types, four skill stages, programme-aware readiness. Stage 3 and
Stage 4 exact interactions remain open design tasks and do not block planning.

---

## FROZEN FOR IMPLEMENTATION PLANNING

The Last Longer skill architecture is **frozen** as of this document.

### The frozen model

```
PRIMARY SKILL TRACK      Recognition
                           -> Stop and Recover
                             -> Modulate Without a Full Stop
                               -> Transfer

SUPPORTING WORK          Pelvic Floor, screener-routed
                         Mobility where appropriate

DAILY PRACTICE           Calm Arousal Breathing

PROGRESSION              Performance-gated
                         Full qualifying sessions only
                         No calendar advancement
                         No punishment for early ejaculation
                         No progression credit from reduced or
                           protective work

MEMBER EXPERIENCE        Open app, see Today, do it
```

### What the freeze means

**No further Last Longer technique research**, unless a specific unresolved
safety or dose decision requires it. Four passes established that the
literature contains no protocol to copy; a fifth will not change that, and the
remaining work is implementation rather than discovery.

The unresolved values are not gaps to research away. They are **knobs to
parameterise**, listed in the final section.

### What is still open

Two things, both of which can be resolved during implementation rather than
before it: the Stage 3 and Stage 4 protocols at the level of exact
interaction, and the readiness thresholds in section 6. Neither blocks
planning.

---

## 0. The epistemic contract

Read this before any number in this document.

Four research passes established that **the literature contains no protocol to
copy**. No behavioural intervention for premature ejaculation has strong
controlled evidence for solo, unsupervised, home use. The two usable protocols
are structurally incompatible. No trial reports a pause duration. No arousal
scale is validated.

So most of the numbers below are ours. They are labelled as ours.

| Label | Meaning |
|---|---|
| `[REPORTED]` | Directly present in a named source. The source is named inline. |
| `[PRODUCT POLICY]` | Our deliberate choice. The reasoning and the informing source are given. |
| `[UNRESOLVED]` | Not ready for a decision. No value is set. |
| `[BLOCKED]` | May exist in a full text that this environment's egress policy prevented reading. |

### Rules about the labels

1. **`[BLOCKED]` is never written as "not reported".** They are different
   facts. One means the study is silent; the other means we could not look.
   Collapsing them is how a guess becomes a citation.
2. **Every numeric protocol parameter names its source inline.**
   `cycles = 3 [Ventus 2020]`, never `cycles = 3 [evidence]`. The protocols
   conflict, and an unattributed number is how two of them get averaged.
3. **`[PRODUCT POLICY]` values are never described to members, reviewers or
   marketing as evidence-based doses.**

### Why this file exists

Three times in this programme a research summary was passed along with more
confidence than it deserved:

- Sphincter Control Training was described as having parallel-group RCT
  evidence. Both arms received it; the randomised variable was a device.
- Ventus 2020 was cited as controlled evidence for the start-stop technique.
  The vibrator was in both active arms, so the trial isolates neither the
  technique nor the device.
- Erkut 2025's breathing effect was reported as significant. The paper's own
  between-group IELT P value is .12.

Each was caught, and only because someone returned to the primary source. The
record lived in chat scrollback, which is precisely where all three errors came
from. A label is only useful if it sits next to the number in a place a
reviewer actually reads.

---

## 1. Hard rules

**Do not average protocols.** Ventus prescribes 3 cycles, 3 times a week.
Dogan prescribes 5 stops plus a terminal 6th, daily. Blueprint does not ship 4.
Where protocols conflict, choose consciously, name the study that informed the
choice, and label the result `[PRODUCT POLICY]`.

**Do not convert a reported minimum into a prescribed dose.** Erkut reports
"at least 10 breaths". At a 10 second cycle that is about 100 seconds, which is
a floor, not a prescription. We do not record 100 seconds.

**Do not carry a cue between components of one trial.** Erkut's supine
reference attaches to the pelvic floor assessment, not to the breathing
exercise. Breathing position stays `[UNRESOLVED]`.

**Absence of a significant within-group decline in one arm is not a
significant between-group difference.** Two within-group tests landing on
opposite sides of 0.05 say nothing about whether the arms differ. That
comparison needs the interaction term.

**No claim that contracting or relaxing the pelvic floor is correct at the
pre-ejaculatory moment.** No head-to-head trial exists. This is stated to
members as a strength, not hidden as a gap.

---

## 2. Source of truth: the evidence table

### 2.1 Ventus 2020: the anchor for solo delivery

Ventus D et al., *Arch Sex Behav* 2020. PMID 31741252. n=50.

| Field | Value |
|---|---|
| Intervention | Vibrator-assisted start-stop `[REPORTED]` |
| Population | Men with PE, mean age 41.7 `[REPORTED]` |
| Delivery setting | Home `[REPORTED]` |
| Solo or partnered | **Solo** `[REPORTED]` |
| Supervised | **Unsupervised**, online questionnaire monitoring `[REPORTED]` |
| Frequency | **3 sessions per week** `[REPORTED]` |
| Programme length | **6 weeks** `[REPORTED]` |
| Session duration | `[BLOCKED]` |
| Cycles / stops | **3** `[REPORTED]` |
| Stop trigger | **Ejaculation feels imminent** `[REPORTED]` |
| Resume trigger | **Two-sided: ejaculation no longer feels imminent, but not so long that erection or desire is lost** `[REPORTED]` |
| Terminal rule | **Ejaculation permitted on the 3rd repetition** `[REPORTED]` |
| Numeric arousal threshold | **Not reported** `[REPORTED as absent]` |
| Fixed pause duration | **Not reported** `[REPORTED as absent]` |
| Breathing protocol | `[BLOCKED]` |
| Pelvic floor cue | `[BLOCKED]` |
| Progression | Calendar-driven, not performance-gated `[INFERRED]` |
| Device | **Purpose-made vibrator, in BOTH active arms** `[REPORTED]` |
| Outcome | d = 1.05 [0.27, 1.82] and 1.07 [0.32, 1.82] vs waitlist `[REPORTED]` |
| Follow-up | 3 and 6 months, maintained `[REPORTED]`; almost certainly within-group `[INFERRED]` |
| Adherence | Diary returners averaged **below** prescribed frequency `[REPORTED]` |
| Adverse events | "No side effects were reported". No instrument evident `[BLOCKED]` |
| Funding / conflicts | `[BLOCKED]` |

**Isolates:** the whole package versus nothing.

**Does NOT isolate:** the technique; the device; any single component. The only
internally valid contrast is the psychobehavioural add-on arm, and that was
**null for PE symptoms** (positive for distress, anxiety and depression).

**Grade: C minus.** The only solo, unsupervised, home RCT with an inactive
comparator. Quote the confidence interval whenever the effect size is quoted:
the lower bound of 0.27 is compatible with a small effect.

### 2.2 Dogan and Kece 2023: protocol source, not efficacy source

*PLoS ONE* 2023;18(8):e0283091. n=80. **Pre-test/post-test quasi-experimental.
NOT randomised.**

| Field | Value |
|---|---|
| Intervention | Group A stop-start; Group B stop-start + SCT `[REPORTED]` |
| Delivery setting | Single private hospital `[REPORTED]` |
| Supervised | **Supervised**, 6 sessions x 45 min, fortnightly `[REPORTED]` |
| Frequency | **Once daily** `[REPORTED]` |
| Block structure | **2-week blocks** `[REPORTED]` |
| Session duration target | **10 to 15 minutes total practice** `[REPORTED]` |
| Cycles / stops | **5 repetitions, voluntary ejaculation on the 6th** `[REPORTED]` |
| Stop trigger | **When the feeling of ejaculation arose** `[REPORTED]` |
| Resume trigger | `[BLOCKED]` |
| Timing method | **Stopwatch** `[REPORTED]` |
| Progression gate | **Advance when the exercise exceeded 10 minutes; if under, repeat the 2-week block** `[REPORTED]`. The only performance gate in the literature. |
| Later stages | Fantasy/pornography, then partner stimulation, then intercourse, then position changes `[REPORTED]` |
| Breathing | Not reported `[REPORTED as absent]` |
| Pelvic floor cue | Contraction paradigm in the SCT arm `[REPORTED]` |
| Follow-up | 3 and 6 months, both groups above baseline `[REPORTED]` |
| Adverse events | `[BLOCKED]` |
| Conflicts | **SCT's originator is an author** `[REPORTED]` |

**Isolates:** nothing causally. Allocation was not randomised.

**Does NOT isolate:** stop-start versus SCT; any efficacy claim.

**Grade: D for efficacy. Useful as protocol evidence only.**

### 2.3 de Carufel and Trudel 2006: the only device-free randomisation

*J Sex Marital Ther* 2006. 36 couples, three arms.

| Field | Value |
|---|---|
| Arms | Functional-sexological / behavioural (squeeze + stop-start) / waitlist `[REPORTED]` |
| Solo or partnered | **Partnered, couple-randomised** `[REPORTED]` |
| Supervised | **Therapist-delivered** `[REPORTED]` |
| Frequency, session duration, cycles | `[BLOCKED]` |
| FS arm content | Sensuality, body movements, speed of activity, muscular tension, breathing. **Arousal control without interrupting** `[REPORTED]` |
| Muscular tension direction | **Reduction / relaxation** of general muscular tension, achieved via slow abdominal breathing `[REPORTED]` |
| Outcome | FS 7.80 min, BT 7.87 min, waitlist 1.00 min. Both p < 0.00001 `[REPORTED]` |
| Follow-up | 3 months, maintained `[REPORTED]` |
| Device | **None** `[REPORTED]` |
| Adverse events | No instrument `[REPORTED]` |

**Isolates:** FS versus BT head-to-head (**equivalent**); both versus nothing.

**Does NOT isolate:** any single component of either multicomponent package;
solo use; unsupervised use.

**The limit that matters.** The paper's reasoning is that rising excitement
makes breathing thoracic and rapid, and that reversing this through slow
abdominal breathing reduces muscular tension, which helps lower excitement.

| Supported | Not supported |
|---|---|
| General muscular-tension reduction was a reported component of the FS package | "de Carufel proved pelvic floor relaxation delays ejaculation" |
| The package matched stop-start | Any single ingredient was causal |

**Pelvic floor contraction versus relaxation at the critical moment remains a
separate and unresolved question.**

**Grade: C.**

### 2.4 Erkut 2025: breathing protocol known, efficacy claim not established

*J Sex Med* 2025;22(8):1422. PMID 40580936. n=62 randomised, 59 completed.

| Field | Value |
|---|---|
| Arms | BT + PFMT + diaphragmatic breathing vs BT + PFMT `[REPORTED]` |
| BT + PFMT frequency | 2x daily, 3 days per week, 8 weeks, **both arms** `[REPORTED]` |
| Breathing frequency | **2x daily, every day, 8 weeks** `[REPORTED]` |
| Breathing pattern | **3 s inhale, 7 s exhale** `[REPORTED]` |
| Holds | **None reported** `[REPORTED as absent]` |
| Breaths per session | **At least 10** `[REPORTED]` |
| Cadence | ~6 per minute, derived from the 10 s cycle `[INFERRED]` |
| Session duration beyond the minimum | `[UNRESOLVED]` |
| Body position | `[UNRESOLVED]`, the supine reference belongs to the pelvic floor assessment |
| Pelvic floor coordinated with breathing | `[UNRESOLVED]` |
| Adherence measurement | `[BLOCKED]` |
| IELT between-group | **P = .12** `[REPORTED]`, inconsistent with the paper's own wording |
| Medians | +283 s vs +204 s `[REPORTED]`, **numerical only** |
| 1-year by group | Within-group decline significant in control, not in breathing arm `[REPORTED]`. Interaction term `[BLOCKED]` |
| Adverse events | `[BLOCKED]` |

**Isolates:** adding breathing, and only if the P value resolves.

**Does NOT isolate:** behavioural therapy; PFMT; breathing as a standalone
intervention; between-group durability.

**Defensible statements, and only these:**

- Both groups improved substantially.
- The breathing group's median IELT increase was **numerically** larger.
- The non-breathing group declined significantly from post-treatment to one year.
- The breathing group showed no significant within-group decline.
- **None of this establishes a significant between-group difference, in effect
  or in durability.**

**Do not write** "diaphragmatic breathing significantly improved IELT over
BT + PFMT".

**Grade: C, provisional.** Protocol availability does not upgrade a statistic.

### 2.5 Remaining studies

| Study | Design | Grade | Isolates | Note |
|---|---|---|---|---|
| van Lankveld 2009 | RCT vs waitlist, n=40 PE, internet-delivered, unsupervised | C (null) | digital delivery vs nothing | **Did not beat waitlist for PE.** The closest analogue to our delivery channel |
| Bustos 2023 | Observational, n=481 | observational | nothing | 62% ejaculated before completing 5 stops. Stops progressively less effective |
| SCT 2019 / 2021 | RCT, SCT+device vs SCT | D (device), untested (technique) | the device | Both arms received SCT. Commercial conflict chain |
| Pastore 2012 | Randomised, PFMT vs dapoxetine | C minus | PFMT vs drug | **Dapoxetine outperformed PFMT** |
| Pastore 2014 | Single-arm | D | nothing | Routinely miscited as an RCT |
| Semans 1956 | Case series, ~8 | F | nothing | **Partner-administered.** The foundation of the field |
| Masters and Johnson 1970 | Uncontrolled | F | nothing | 97.8% never replicated. Squeeze dose conflicts, 4 s vs 20 s `[BLOCKED]` |

### 2.6 Guideline position

**No guideline grades stop-start as a standalone intervention.** The highest
graded statement in the field is AUA/SMSNA **Grade B for behavioural plus
pharmacological combination**. EAU: "weak and inconsistent evidence, long-term
outcomes unknown". BSSM cites Ventus approvingly and reproduces its framing
**without separating the device**.

---

## 3. Rulings P1 to P11

| # | Decision | Value | Label |
|---|---|---|---|
| P1 | Cycles per skill session | **3** | `[PRODUCT POLICY]`, informed primarily by Ventus 2020 |
| P2 | Full skill sessions per week | **2** | `[PRODUCT POLICY]` |
| P3 | Session duration | **Cycle-driven, no elapsed-time target** | `[PRODUCT POLICY]` |
| P4 | Pause duration | **No timer. Phenomenological condition** | `[PRODUCT POLICY]`, trigger wording `[REPORTED Ventus]` |
| P5 | Breathing dose | **1 required practice per day**, 3:7, at least 10 breaths | frequency `[PRODUCT POLICY]`, pattern `[REPORTED Erkut]` |
| P6 | Breathing position | **Sit or lie somewhere comfortable** | `[PRODUCT POLICY]`, not an active ingredient |
| P7 | Breathing and pelvic floor | **Kept separate** | `[PRODUCT POLICY]` |
| P8 | Progression gate | **2 consecutive successful sessions**, configurable | `[PRODUCT POLICY]` |
| P9 | Programme length | **Performance-gated, not calendar-gated** | `[PRODUCT POLICY]` |
| P10 | Squeeze / Lateral Compression | **Removed from the core programme.** Legacy/optional, not required for adherence or progression | `[PRODUCT POLICY]` |
| P11 | Hand-only vs device | **Hand-only default** | `[PRODUCT POLICY / EXTRAPOLATION]` |

### Rationale notes that must travel with the numbers

**P1.** Ventus is the stronger design and reports 3. A smaller fixed count
reduces burden, and Bustos indicates repeated stops become progressively less
effective while many men cannot complete five. **3 is not claimed to be
clinically optimal.**

**P2.** Deliberately below Ventus's 3 per week, because Blueprint also carries
daily breathing, pelvic floor supporting work and later lighter modulation
practice. The programme optimises for adherence rather than reproducing the
highest research frequency. A third lighter exposure may be earned later.

**P3.** The member is never told he needs to last 10 minutes to succeed.
A duration ceiling may exist later for safety; it must not become the training
outcome.

**P5.** The research dose was twice daily. Ours is once. **We do not claim
once-daily reproduces the trial's outcomes.** A second practice is offered,
not required.

**P8.** One success is too noisy; four or more creates friction. Two is the
starting threshold and lives in `PROGRESSION_POLICY`. **An early finish is
information. No punitive language, no lost streak, no reset-to-zero framing.**
It simply does not satisfy the gate.

**P11.** Ventus used a purpose-made vibrator in **both active arms**, so its
randomised evidence does not establish that an otherwise identical hand-only
protocol produces the same effect. We choose hand-only because it requires no
purchase, lowers friction, and is easier to practise consistently. **This is an
extrapolation and the internal record says so.**

---

## 4. Taxonomy: three kinds of work

An earlier draft carried a one-off exception allowing breathing to survive a
Rest day. That was a contradiction patched with a special case. The structure
below removes it generically: **there are three kinds of work, and Rest
withholds two of them.**

| Kind | What it is | Examples |
|---|---|---|
| **Primary Training Session** | The main programme stimulus. At most one per day. **The only thing that can earn progression.** | Recognition, Stop and Recover, Modulation, Transfer, Length, Girth |
| **Supporting Work** | Secondary scheduled work that supports the programme. Zero or more per day. | Pelvic Floor Strength and Control, Pelvic Floor Relaxation and Coordination, Mobility |
| **Daily Practice** | Low-burden cadence-based work that may continue on a Rest day **without converting it into a training day**. | Calm Arousal Breathing |

### What Rest means, precisely

```
mode = rest   →   no Primary Training Session
                  no Supporting Work
                  Daily Practice continues
```

Rest is still a prescription and still means no training. **Low-burden Daily
Practice may continue on Rest without converting the day into a training
day.**

Stated without a duration deliberately. The Calm Arousal Breathing
prescription is a count of breaths, not a span of minutes, and encoding an
inferred time value into the architecture would smuggle back the number the
document declined to invent.

**This is a generic third work type, not a breathing carve-out.** Any future
low-burden daily item uses the same slot and inherits the same rule.

### Three completion truths, never summed

Adding a third kind of work adds a third thing to be true or false about a
day. They are reported separately.

| Truth | Numerator | Denominator | Drives |
|---|---|---|---|
| **Programme adherence** | completed Primary + Supporting Work | assigned Primary + Supporting Work | the weekly headline |
| **Daily Practice adherence** | practices completed | days elapsed | its own quiet line |
| **Progression qualification** | sessions meeting the stage gate | sessions required | stage advancement |

**A day plan's `status` reflects Primary and Supporting Work only.**

This is a hard rule, not a default:

- `dayPlan.status` is computed from scheduled Primary plus Supporting Work,
  and from nothing else.
- **Missing Calm Arousal Breathing must never turn a Rest day into a missed
  programme day.** A Rest day asks for no session work, so there is no session
  work to fail.
- Daily Practice surfaces independently in Progress, for example
  `Calm Arousal Breathing 5/7 days`, with **no effect on the day's
  training-state truth**.
- **The three truths never collapse into one score.** There is no combined
  percentage anywhere, because the moment one exists somebody will optimise
  the easy component to move it.

---

## 5. The skill track

### Stage 1. Recognition

**Objective: the first meaningful recognition of the rising urge.** That is the
primary event of the session, and everything else is secondary.

One button, and the interface is nothing else.

```
TODAY - Recognition
One job: notice the moment the urge becomes recognisable.

                    [ I FEEL IT ]
```

On the **first** tap, the app reinforces what just happened:

> "That is the feeling we are training you to catch earlier."

He may continue the session or finish normally. Further taps are recorded if
useful, but **Stage 1 is not a tap-count exercise** and the member is never
shown a target number of taps.

No cycle requirement. No stopping requirement. No elapsed-time requirement.
No clock on screen. **Intentionally unfailable.**

**Why a recognition stage exists at all** `[PRODUCT POLICY]`. No trial has one.
Every protocol's stop trigger is phenomenological, so the cue has to be
detectable before any tool can be applied, and Bustos indicates detection is
the binding constraint: 62% of 481 men ejaculated before completing a
five-stop exercise `[REPORTED]`. An opening session most men fail loses them
in the first week.

**Progression** `[PRODUCT POLICY]`: recognised the urge before finishing, in
2 consecutive full sessions. **An early finish is information, not failure.**

### Stage 2. Stop and Recover

3 cycles `[PRODUCT POLICY, informed by Ventus 2020]`.

```
Cycle 1 of 3
Stimulate. When it feels close:            [ STOP ]
        |
Hand off completely. Wait until the urge passes,
but not so long that the erection goes.
                           [ I'M BACK IN CONTROL ]
        |
Cycle 2 of 3 ...
Cycle 3 - you can finish on this one.
```

**No pause countdown** `[P4]`. The member's tap ends the pause. **No
elapsed-time target** `[P3]`. Three cycles done is the session done.

The pause screen carries **both halves** of the resume condition, because the
two-sided form is `[REPORTED Ventus]` and the currently shipped copy states
only the first half.

**A successful session** `[PRODUCT POLICY, P8]`: prescribed cycles completed,
no ejaculation before the intended terminal cycle, the rising urge recognised
in time to use the assigned tool, and sufficient control regained to resume.

### Stage 3. Modulate Without a Full Stop

**Objective: reduce dependence on a complete stop by developing more than one
usable non-stop control tool.**

Not four mandatory mini-levels. **An adaptive tool curriculum.**

- **Blueprint assigns the tool. The member never chooses.**
- One tool is taught at a time.
- Performance is tracked **per tool**.
- A tool becomes **demonstrated** once its success criterion is met.
- **Stage 4 becomes eligible when more than one non-stop tool is
  demonstrated.** The required count and the per-tool success criterion are
  configurable `[PRODUCT POLICY]`.

**Stop remains the safe fallback.** If the assigned tool is not enough, the
member stops completely and regains control, and that cycle counts as a Stage 2
cycle inside a Stage 3 session. **This preserves prior skill instead of turning
Stage 3 into pass or fail.**

Candidate tools, in proposed teaching order `[PRODUCT POLICY]`:

| Order | Tool | Why here |
|---|---|---|
| 1 | Reduce tempo | most concrete, easiest to execute alone |
| 2 | Reduce stimulation intensity | same axis, finer control |
| 3 | Release unnecessary whole-body tension | `[REPORTED]` as a de Carufel FS component |
| 4 | Integrate breathing | the member already owns the pattern from Daily Practice |

**Ordering is ours.** de Carufel showed a multicomponent package containing
several of these matched stop-start. It proved nothing about which one works,
and nothing here should imply otherwise.

**Do not hard-code four mandatory tool levels.** The curriculum is a list, the
gate counts demonstrated tools, and both are configuration.

### Stage 4. Transfer

More realistic movement, position and stimulation contexts. `[REPORTED]` as a
late stage in both Dogan's progression and SCT phase 4.

Dogan's later stages also include partner stimulation and intercourse
`[REPORTED]`. **The app cannot run a timed session for those**, so it briefs
rather than prescribes. The programme stops where the app can no longer
observe anything, and that boundary is deliberate.

Exact protocol remains an open design task.

---

## 6. Readiness adaptation and earned progression

### The governing principle

> **Blueprint can reduce what the member has to do today without lowering what
> he has to demonstrate before progressing.**

That is the whole relationship between readiness and progression. It closes a
hole in an earlier draft where a reduced session still satisfied the
advancement gate, which made reporting soreness a cheaper route to a higher
stage.

### Qualification matrix

| Session as delivered | Programme adherence | Progression qualification |
|---|---|---|
| **Full prescribed session** | yes | **yes, possible** |
| **Modified** (reduced) | yes | **no, by default** |
| **Protective / support only** | yes, if completed as assigned | **no** |
| **Rest, as prescribed** | not counted either side | **no** |
| **Missed** | no | **no** |

**Equivalency rules remain architecturally possible.** Some future reduced
session might be made to qualify under defined conditions. None is invented
now, and the default is that a reduced session does not qualify.

### Readiness modifiers are programme-aware

> **A readiness modifier may depend on the location and type of discomfort,
> not only its global severity. One global soreness level does not map
> identically across Size, Last Longer, Erection Quality and Everything.**

This replaces an earlier draft which stated, as though it were architectural
truth, that moderate soreness reduces Stages 2 to 4 to two cycles. **That
generalised a signal too coarse to carry it.**

The existing readiness field is a single global severity
(`none | mild | moderate | high`). For Length and Girth, where the training
stress is mechanical loading of tissue, a global severity is a defensible
proxy. For Last Longer it is not, because the relevant question is not only
how sore but **where, and whether it is relevant to today's training**:

- moderately sore legs after a run have little to do with an arousal-control
  session, and reducing that session would be a false precaution
- moderate penile, perineal or pelvic discomfort is **not** answered by a
  *shorter* arousal-control session, because the problem is the stimulation
  itself rather than its volume
- **pain or meaningful genital irritation must never become an opportunity to
  earn adherence through stimulation**

### Last Longer policy direction

Direction, not thresholds.

| Signal | Direction |
|---|---|
| Unrelated or general soreness | little or no effect on the Primary Training Session |
| Relevant genital, perineal or pelvic discomfort | may modify **or withhold** the Primary Training Session |
| Pain, or high relevant discomfort | **no stimulation-based Primary Training Session** |

Recorded explicitly so none of it is assumed:

- The global `soreness` field **stays** for compatibility.
- The readiness UI is **not** redesigned in this document.
- Exact mild and moderate rules remain `[PRODUCT POLICY]`, to be resolved
  during readiness implementation.

**Consequence for existing code, noted and not acted on.**
`modifiers.moderateSoreness` in `src/nextBestAction.js` is currently a single
universal lever applied the same way to every mission. A programme-aware model
needs either a programme-scoped modifier or a location-aware input. That is a
Phase 3S implementation decision. **Nothing in the resolver changes here.**

### The shape a modification takes, when one is right

Where a reduction **is** the correct response, the shape for a cycle-driven
session is **3 cycles to 2** `[PRODUCT POLICY]`, and the session is adherence
only. This survives as the form of a modification, **not as the automatic
answer to a global severity reading**.

Below two cycles there is no approach and retreat left, so the day becomes
support only rather than a token session. That is the minimum meaningful dose
rule applied to this programme.

Stage 1 has nothing to reduce. Where a Stage 1 session runs at all it is a
full prescribed session and it qualifies.

### Deload

A deload week reduces Stages 2 to 4 to 2 cycles, adherence only, not
qualifying `[PRODUCT POLICY]`. Deload is programme state rather than a
readiness signal, so it is not subject to the location question above.

---

## 7. State and logging

### Progression state

```
lastLonger: {
  stage: 1 | 2 | 3 | 4,
  consecutiveSuccesses: int,        // stages 1, 2 and 4. Resets on advance,
                                    // never on a failed session.
  stage3: {
    currentTool: toolId | null,
    tools: {
      [toolId]: { consecutive: int, demonstrated: bool }
    }
  },
  stageEnteredAt: date,             // record only, never a gate  [P9]
}
```

**Minimum clean state for Stage 3 is two fields per tool.** `consecutive`
drives the gate; `demonstrated` is stored rather than derived because it must
be sticky.

### Counter semantics

"Consecutive" is ambiguous without these four rules, so they are the rules.

| Event | `consecutive` | `demonstrated` | Adherence | Qualification |
|---|---|---|---|---|
| **Full qualifying session, successful** | **+1** | set true at threshold | yes | yes |
| **Full qualifying session, unsuccessful** | **reset to 0** | unchanged | yes | no |
| **Modified session** | **unchanged** | unchanged | yes | **no** |
| **Protective / withheld** | unchanged | unchanged | yes, if completed as assigned | no |

1. `consecutive` advances **only** from a full qualifying session.
2. A **modified** session leaves the counter **unchanged**. It does not
   advance it and it does not reset it.
3. A **qualifying failure** resets that tool's `consecutive` to zero.
4. Once `demonstrated` is true it **stays** true. A later unsuccessful session
   never removes it.

**The asymmetry in rule 2 is deliberate.** A reduced session is not a failure;
it is a session that could not qualify. Resetting a counter because the app
decided to lighten the day would punish the member for the app's own
adaptation, and it would quietly undo the governing principle above.

**Rule 4 mirrors tier ownership, which is never revoked.** The principle is
worth stating in its own words: **temporary performance fluctuates; earned
capability does not disappear.**

`demonstratedTools` is not stored. It is
`Object.keys(tools).filter(t => tools[t].demonstrated)`, and storing both
invites them to disagree.

Optional analytics only, not required by any gate: `attempts` and `successes`
totals per tool.

Policy values, all configurable and all `[PRODUCT POLICY]`:
`successesRequired: 2`, `toolSuccessesRequired`, `toolsRequiredForStage4: 2`.

**No week counter anywhere.** Progression is earned, not elapsed `[P9]`.

### What a skill session logs

```
{ stage, cyclesPrescribed, cyclesCompleted,
  recognisedInTime: [bool per cycle],
  regainedControl:  [bool per cycle],
  outcome: 'completed' | 'early' | 'noFinish',
  toolUsed, fellBackToStop: bool,
  qualifying: bool,                 // false for any modified session
  durationSeconds }                 // recorded, never shown as a target
```

Duration is captured because the app currently logs nothing about performed
work, which the Phase 3S audit named as its largest data gap. **It is never
surfaced as a goal** `[P3]`, and it is not an IELT measurement.

`qualifying` is written at log time rather than inferred later, so a session's
status cannot be re-judged by a future policy change. That is the same
property the progression ledger exists to protect.

---

## 8. The Today experience

```
+--------------------------------+
| TODAY                          |
| Stop & Recover                 |
| 3 cycles                       |
| [ START SESSION ]              |
| 1 of 2 successful sessions     |   <- earned, not elapsed  [P9]
+--------------------------------+
  Daily Practice - Calm Arousal Breathing - 10 breaths
```

One card, one obvious action, Daily Practice as a quiet line beneath.

**The practice is expressed in breaths, not minutes.** We deliberately declined
to convert Erkut's "3:7, at least 10 breaths" into a time prescription, so the
member must see the unit that was actually prescribed. Showing "2 min" would
reintroduce the invented number through the interface after the design
document had refused it.

On a Pelvic day the Supporting Work promotes into the primary slot and the card
reads Pelvic Floor, Relaxation and Coordination. On a Rest day the card says
Rest with no call to action, and the Daily Practice line remains.

The member never chooses the stage, the cycle count, the tool, the pelvic
category, or whether he has progressed.

---

## 9. Consequences for the generic day plan model

The third work type changes the shape proposed in the Phase 3S architecture
pass.

```js
dayPlan = {
  date,                      // ISO date, not a weekday index
  mode,                      // prescribed | modified | protective | rest
  primarySession: { type, tier, dose } | null,
  supportingWork: [ { type, category, dose, required } ],
  dailyPractice:  [ { type, dose, required } ],   // NEW
  status,                    // pending | completed | partial | missed
}
```

Four consequences, and the third is the one that matters:

1. **`dailyPractice` is a third array**, not a flag on `supportingWork`.
   A flag would make every consumer of `supportingWork` responsible for
   remembering to filter it out, and one of them eventually would not.
2. **`mode: 'rest'` constrains `primarySession` and `supportingWork` only.**
   A rest day may carry a non-empty `dailyPractice`, and that is the whole
   point of the type.
3. **`status` is computed from Primary and Supporting Work only.** Daily
   Practice completion is recorded against the date, not folded into the day's
   status, so a missed practice can never mark a Rest day as missed.
4. **Daily Practice never enters `MECHANICAL_TYPES`** and so can never reach
   progression qualification, by the same structural guarantee that keeps
   Supporting Work out of it.

### The legacy schedule projection is an external contract

The persisted `schedule` jsonb column has a **server-side consumer outside the
application**: `supabase/functions/_shared/notifyRules.js`. It expects

- an array,
- of **exactly 7 elements**,
- with **Sunday-indexed** weekday semantics,

and uses that representation for **rest-day notification suppression**. The
column is selected in `supabase/functions/send-notifications/index.ts` and
passed through to that rule.

Therefore, during the day-plan migration:

- Day plans may become the **authoritative programme model**.
- The legacy `schedule` value becomes a **derived compatibility projection**.
- That projection **must continue to be persisted in the exact current
  7-element Sunday-indexed shape**.
- The `schedule` column **may not change shape**.
- The column **may not be retired**.
- The projection **may not stop being written**.

until `notifyRules.js` **and every other external consumer** have been
explicitly migrated.

**Retiring the projection must be a separate verified migration, not
incidental cleanup.** The failure mode if this is forgotten is silent: rest-day
push suppression breaks server-side, and nothing inside the app reports it.

This is not internal backward compatibility. **Treat it as an external
contract.**

### One source of truth, temporarily multiple representations

```
day plans         ->  authoritative programme truth
legacy schedule   ->  derived compatibility output
```

Day plans may become authoritative **without immediately becoming the only
representation**. During migration the stack is intentionally

```
authoritative day-plan model
  -> legacy 7-day schedule projection
    -> existing client and server consumers
```

That duplication is acceptable **because it is an explicit compatibility
bridge with a direction of flow**. The projection is derived from the
authoritative model, never edited independently, and retired only once its
consumers are migrated.

**What is not acceptable is two independently editable programme truths.** If
anything ever writes to the projection directly, the bridge has become a fork
and the migration has failed.

### Historical truth during migration

Carried as migration invariants, not as defaults:

- **No historical day-plan backfill.** For a date before day plans existed the
  honest value is absent.
- **Stored `progression_ledger.targetSessions` is historical truth** and is
  never recomputed from day plans.
- **A past week is never re-derived** from a model that did not exist when it
  elapsed.
- **`unknown` remains a legitimate state**, not a gap to fill.
- **Policy changes never rewrite historical qualification.**

---

## 10. Open items

### Blocked cells

| # | Cell | Source | What it blocks |
|---|---|---|---|
| 1 | Breathing session duration, position, pelvic floor coordination | Erkut | the full breathing prescription |
| 2 | IELT interaction term, resolution of P = .12 | Erkut | any between-group breathing claim |
| 3 | Session duration, pause duration | Ventus | session and pause design |
| 4 | Adherence figures | Ventus | quantifying the adherence constraint |
| 5 | Funding and conflicts | Ventus | any marketing citation |
| 6 | Per-trial extraction tables, quality assessment | Cooper / NIHR | independent verification |
| 7 | Squeeze dose | Masters and Johnson primary | whether the squeeze has a defensible dose |
| 8 | Resume trigger | Dogan | not retrievable |
| 9 | Adverse event collection | Dogan, Erkut | all safety claims |

This environment's egress policy blocks journal full texts. Confirmed denied:
`pmc.ncbi.nlm.nih.gov`, `www.ncbi.nlm.nih.gov`, `journals.plos.org`,
`academic.oup.com`, `www.tandfonline.com`.

### Open design tasks

- **Stage 3 per-tool success criterion** and `toolsRequiredForStage4`. The
  shape is settled (adaptive curriculum, sticky demonstration, stop as
  fallback); the two numbers are not.
- **Stage 4 transfer protocol.**
- Whether the squeeze retains any role. P10 left it as legacy content,
  required by nothing.
- Whether any reduced session should ever qualify for progression. The
  architecture permits an equivalency rule; none is defined, and the default
  is that it does not.

Resolved by the taxonomy correction, recorded so the reasoning is not lost:

- **The Rest-day breathing contradiction.** Previously patched with a one-off
  exception. Now resolved by Daily Practice as a third work type, so Rest
  withholds Primary and Supporting Work and nothing needs a carve-out.
- **Reduced sessions earning advancement.** Previously a hole: moderate
  soreness cut three cycles to two and the session still satisfied the gate,
  which made soreness a cheaper route to a higher stage. Now closed by the
  governing principle in section 6.

### Carried debt from elsewhere in 3S

- The pelvic screener result copy still says kegels "would make that worse".
  Guidelines support only a precautionary framing: the AUA statement is
  "should be avoided, may worsen the condition", which is expert opinion plus
  mechanism, **not a demonstrated harm**. No trial has randomised men with an
  overactive floor to contraction work and measured harm.
- The Edging session dose remains roughly a third of anything trialled. It is
  untouched pending this redesign.

---

## 11. What this is

The research does not contain a routine to copy. Four passes established that
fairly conclusively.

So the output is a trainable skill extracted from the overlap, a clear label
on every number we chose ourselves, and a progression a man will actually
complete. **`[PRODUCT POLICY]` values outnumber `[REPORTED]` ones here by
roughly two to one.** That is the honest consequence of the evidence base, and
it is the reason this file exists rather than another conversation.

---

## 12. Parameterisation list for implementation planning

Every `[PRODUCT POLICY]` value in this document, with its proposed starting
value and where it belongs. **These are knobs, not findings.** They go in
`PROGRESSION_POLICY` alongside the existing progression numbers, under the
header already there stating that not one of them is a medical constant, a
physiological threshold, or a finding from any literature.

### Skill session shape

| Knob | Proposed start | Informed by |
|---|---|---|
| `cyclesPerSession` | **3** | Ventus 2020 reports 3 |
| `cyclesWhenModified` | **2** | minimum meaningful dose for a cycle-driven session |
| `skillSessionsPerWeek` | **2** | below Ventus's 3, chosen for adherence |
| session duration target | **none** | cycle-driven, not stopwatch-driven `[P3]` |
| pause duration | **none** | no timer; the member's tap ends the pause `[P4]` |

### Progression gates

| Knob | Proposed start | Note |
|---|---|---|
| `successesRequired` | **2** | consecutive, for Stages 1, 2 and 4 |
| `toolSuccessesRequired` | **unset** | per-tool criterion for Stage 3 |
| `toolsRequiredForStage4` | **2** | "more than one demonstrated tool" |
| Stage 1 success | recognised before finishing | |
| Stage 2 success | cycles completed, no early finish, recognised in time, control regained | |
| Stage 3 success | at least 2 of 3 cycles controlled without a full stop | |

### Daily Practice

| Knob | Proposed start | Note |
|---|---|---|
| `breathsPerPractice` | **10 minimum** | `[REPORTED Erkut]`, a floor not a prescription |
| breathing pattern | **3s in, 7s out, no holds** | `[REPORTED Erkut]`, not a policy value |
| `practicesPerDay` | **1 required** | research dose was 2; ours is 1, for adherence |
| position | **not prescribed** | `[P6]`, not an active ingredient |
| maximum session length | **unset** | `[UNRESOLVED]`, blocked in the source |

### Readiness

| Knob | Proposed start | Note |
|---|---|---|
| discomfort location model | **unset** | section 6. The architectural rule is fixed; the thresholds are not |
| relevant-discomfort thresholds | **unset** | resolve during readiness implementation |
| unrelated-soreness effect | **little or none** | direction only |
| pain response | **no stimulation-based Primary Session** | direction only, and the one with a safety cost |

### Curriculum

| Knob | Proposed start | Note |
|---|---|---|
| Stage 3 tool order | tempo, intensity, tension, breathing | ordering is ours; de Carufel proved nothing about which works |
| squeeze retained | **no, legacy only** | `[P10]`, required by nothing |
| hand-only vs device | **hand-only** | `[P11]`, recorded as an extrapolation |

### Rules that are not knobs

These are architecture and must not be made configurable, because making them
adjustable is how they get adjusted:

- A reduced session never qualifies for progression.
- `demonstrated` is never revoked.
- Daily Practice never affects `dayPlan.status`.
- Daily Practice and Supporting Work never enter `MECHANICAL_TYPES`.
- No combined adherence score exists.
- No calendar advancement anywhere.
