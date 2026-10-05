# Last Longer: evidence record and design

Phase 3S. **Design document. Nothing here is implemented.**

Status: rulings P1 to P11 locked. Three-track model approved. Stage 3 and
Stage 4 protocols are open design tasks.

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

### 2.1 Ventus 2020 — the anchor for solo delivery

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

### 2.2 Dogan and Kece 2023 — protocol source, not efficacy source

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

### 2.3 de Carufel and Trudel 2006 — the only device-free randomisation

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

### 2.4 Erkut 2025 — breathing protocol known, efficacy claim not established

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
| Body position | `[UNRESOLVED]` — the supine reference belongs to the pelvic floor assessment |
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

## 4. The three-track model

### Skill track

**Stage 1. Recognition.** Learn to notice the rising urge before control is
lost. No cycle requirement, no stopping requirement, no elapsed-time
requirement. **Intentionally unfailable.** An early finish is data.

**Stage 2. Stop and Recover.** 3 cycles. Approach the urge, stop completely,
regain control without waiting so long that erection or desire disappears,
resume. The terminal cycle may end in ejaculation.

**Stage 3. Modulate Without a Full Stop.** Introduced once Recognition and
Stop and Recover are reliable. Candidate tools: reduce tempo, reduce
stimulation intensity, reduce unnecessary whole-body muscular tension,
breathing. **Stop remains available as a fallback, and using it is not a
failure.** Exact protocol is an open design task.

**Stage 4. Transfer.** More realistic movement, position and stimulation
contexts. Exact protocol is an open design task. The programme stops where the
app can no longer observe anything; partnered contexts are briefed, not
prescribed as timed sessions.

### Parallel support tracks

**Calm Arousal Breathing.** Regular low-burden supporting work. Does not count
as a primary progression session. **No IELT promise.**

**Pelvic Floor.** Screener-routed: standard goes to Strength and Control;
tight or unscreened goes to Relaxation and Coordination. Purpose is awareness
and control support. **No claim that contracting or relaxing at the
pre-ejaculatory moment is proven superior.**

### Member experience

The member never chooses which stage to train, how many cycles, whether today
is skill practice or support, which pelvic floor category, or whether he has
progressed. **Open app, see what today is, do it.**

---

## 5. Amendments to earlier 3S architecture

Recorded rather than folded in silently.

**A1. Breathing persists on Rest days.** The earlier rule was that a true rest
day carries no supporting work. Breathing is a two-minute daily practice and
the only element of the programme with daily cadence; withholding it two days
a week would break that cadence to protect a rule about session work. **Rest
still means no session work.**

**A2. "Stopping is a tool, not the skill" is reclassified.** It is a
**Blueprint design inference supported by overlapping behavioural evidence**,
not a research finding. de Carufel showed two multicomponent packages
performed similarly. It did not show stopping is irrelevant and it identified
no causal ingredient. The same applies to the core skill statement: *recognise
rising arousal and regain control* is **our abstraction across the evidence**,
not something a single trial proved.

---

## 6. Open items

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
| 8 | Resume trigger | Dogan | — |
| 9 | Adverse event collection | Dogan, Erkut | all safety claims |

This environment's egress policy blocks journal full texts. Confirmed denied:
`pmc.ncbi.nlm.nih.gov`, `www.ncbi.nlm.nih.gov`, `journals.plos.org`,
`academic.oup.com`, `www.tandfonline.com`.

### Open design tasks

- Stage 3 protocol and tool ordering
- Stage 4 transfer protocol
- Whether the squeeze retains any role (P10 left it as legacy content)

### Carried debt from elsewhere in 3S

- The pelvic screener result copy still says kegels "would make that worse".
  Guidelines support only a precautionary framing: the AUA statement is
  "should be avoided, may worsen the condition", which is expert opinion plus
  mechanism, **not a demonstrated harm**. No trial has randomised men with an
  overactive floor to contraction work and measured harm.
- The Edging session dose remains roughly a third of anything trialled. It is
  untouched pending this redesign.

---

## 7. What this is

The research does not contain a routine to copy. Four passes established that
fairly conclusively.

So the output is a trainable skill extracted from the overlap, a clear label
on every number we chose ourselves, and a progression a man will actually
complete. **`[PRODUCT POLICY]` values outnumber `[REPORTED]` ones here by
roughly two to one.** That is the honest consequence of the evidence base, and
it is the reason this file exists rather than another conversation.
