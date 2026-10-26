# What Should I Work On? Assessment logic

The page is `/assessment/`. This document is the specification, the review
artifact, and the thing `tests/assessment.test.js` checks the page against.
Change one and you change all three.

## What it is, and what it refuses to be

Five questions, answered privately, that point a visitor at the Learning
Centre guide most likely to be useful and give him two things he can do for
free this week.

It cannot diagnose erectile dysfunction, premature ejaculation, pelvic floor
dysfunction or anything else, and it says so on the question screen, on
every result, and in the medical note. It is a starting point for reading,
and nothing in it should read as a verdict.

## Privacy

Answers live in one JavaScript object inside a closure for the life of the
page view. That is the whole storage design.

Nothing is written to `localStorage`, `sessionStorage` or cookies. Nothing
goes into the URL, so a result cannot be shared or recovered by link and
cannot leak through a referrer header. There is no `fetch`, no
`XMLHttpRequest`, no `sendBeacon`, no analytics, no third party of any kind.
Closing or reloading the tab destroys the answers, which is the intended
behavior and is stated on the page.

This matters more here than almost anywhere else on the site. A man
answering "pain during sex, more than six months, never discussed with a
doctor" has handed over something genuinely sensitive, and the only
defensible design is one where there is nothing to leak.

## The five questions

Question 3 is conditional. Everything else is asked of everyone, and every
question can be skipped.

### Q1. Primary concern (`concern`)

Determines the branch.

| Value | Label |
|---|---|
| `erection` | Getting or keeping an erection |
| `timing` | Finishing sooner than I want |
| `pain` | Pain or discomfort in the pelvic area |
| `conditioning` | General conditioning and comfort during sex |
| `unsure` | Not sure, or several of these |

### Q2. Where it happens (`where`)

Options adapt to Q1.

- **erection**: `partner_only` (with a partner, rarely alone), `both`
  (alone and with a partner), `varies`
- **timing**: `partner_only`, `both`, `varies`
- **pain**: `sex` (during or after sex), `urinating` (when urinating, or
  blood in urine or semen), `most` (most of the time, unrelated to sex),
  `varies`
- **conditioning**: `positions` (some positions get uncomfortable),
  `stamina_physical` (I tire physically), `general`
- **unsure**: `partner_only`, `both`, `varies`

`pain` + `urinating` is a **red flag**. See safety logic.

### Q3. Morning and solo erections (`morning`), conditional

Asked when Q1 is `erection`, `timing` or `unsure`. Skipped entirely for
`pain` and `conditioning`, because it has no bearing on the result there and
asking it anyway is the kind of thing that makes a tool feel like a form.

Values: `usually` (usually present and firm), `sometimes`, `rarely` (rarely
or never), `unknown` (not sure, I have not paid attention).

### Q4. How long, or how it compares (`duration`)

Adaptive, like Q2, and for a clinical reason.

For every branch except timing: `lt1m` (less than a month), `1to6m`,
`gt6m` (more than six months), `always` (as long as I can remember).

For the timing branch the question becomes "How does this compare to
earlier in your life?" with:

- `changed_recent`: it used to be satisfactory, and changed within the
  last six months
- `changed_long`: it used to be satisfactory, and changed more than six
  months ago
- `always`: it has been this way since I became sexually active
- `unsure_history`: I am not sure how it compares to before

**Why the timing branch is different.** Clinicians separate lifelong
premature ejaculation from the acquired kind, which follows a period of
satisfactory control, because the two lead them to look at different
things. Duration cannot make that distinction. A man who has had the
difficulty since his first experiences and only began minding it last
month would read as a recent change, and the first version of this
assessment would have told him so. The timing branch therefore asks about
the comparison directly, and carries the duration inside the same options,
which keeps the flow at five questions.

### Q5. Medically evaluated (`seen`)

`evaluated` (yes, examined for this), `mentioned` (mentioned it, no
examination), `no`, `prefer_not` (prefer not to say).

## Result profiles

Exactly one profile is selected. Rules are evaluated in order and the first
match wins, so the urgent rule can never be outranked.

### 1. `urgent` — Symptoms that should be looked at promptly

**When:** Q2 is `urinating`.

Pain on urination, or blood in urine or semen, is not something to read an
article about this week. The result says so, offers no exercise, and gives
the two free actions as contacting a clinician and writing down specifics to
bring. It links to no guide as a primary action, because sending a man with
possible infection to a breathing routine is the failure mode worth
designing against.

### 2. `pelvic` — Pelvic discomfort

**When:** Q1 is `pain` (and not already urgent).

Points at the pelvic floor guide, with the assessment's strongest
non-urgent steer toward a pelvic health physiotherapy assessment. States
plainly that symptoms cannot establish whether muscles are overactive or
weak, and that Kegel exercises can make an overactive pelvic floor worse, so
the free action is the relaxation routine and explicitly not strengthening.

### 3. `erection_physical` — Worth a general health check

**When:** Q1 is `erection` or `unsure`, and either Q3 is `rarely`, or Q2 is
`both` together with Q4 being `gt6m`.

Difficulty in every situation, or morning erections that have become rare,
is the pattern that makes clinicians look harder at circulation, nerves and
hormones. Points at the blood sugar guide and the metabolic habits check,
and recommends asking for blood pressure, cholesterol and blood sugar to be
reviewed together.

### 4. `erection_situational` — Looks situational

**When:** Q1 is `erection` or `unsure`, Q2 is `partner_only`, and Q3 is
`usually` or `sometimes`.

Strong alone, difficult with a partner. Points at the performance anxiety
guide and its seven-day consistency check. States that this pattern cannot
rule out a physical cause.

### 5. `erection_mixed` — Not enough to tell yet

**When:** Q1 is `erection` or `unsure` and nothing above matched, typically
`varies` or `unknown` answers.

The honest result. Says the answers do not point clearly in one direction,
and that a week of observation will say more than more questions would.

### 6. `timing_acquired` — A reported change

**When:** Q1 is `timing` and Q4 is `changed_recent` or `changed_long`.

Fires only when the visitor reports the change himself. The copy says what
he told us and immediately adds that only a clinician can confirm it.

### 7. `timing_lifelong` — Arousal awareness

**When:** Q1 is `timing` and Q4 is `always`.

Points at the stamina guide's seven-day arousal awareness plan and the
pelvic floor guide as secondary.

### 8. `timing_general` — Ejaculation timing concerns

**When:** Q1 is `timing` and the history was not established, meaning Q4 is
`unsure_history` or was skipped.

The neutral result. It states that clinicians separate the two patterns,
that this assessment did not establish which applies, and that it is
therefore not assuming either. It routes the history question to a
clinician who can ask it properly with follow-up, and offers the arousal
awareness plan, which is safe and useful whichever pattern turns out to
apply.

### 9. `conditioning` — Comfort and positioning

**When:** Q1 is `conditioning`.

Points at the hip mobility guide. Repeats that guide's distinction: the
musculoskeletal benefits are well supported and the sexual-function claims
are not.

## Medical safety logic

Three layers, all independent of which profile is selected.

**Layer 1, the urgent rule.** Evaluated first, outranks everything.
Triggered by Q2 `urinating`. The result replaces the normal content rather
than adding a banner to it.

**Layer 2, the evaluation steer.** A persistent problem that has never been
examined gets an added emphasis block on any non-urgent result. Triggered
when `duration` is `gt6m`, `always` or `changed_long`, and `seen` is `no`
or `mentioned`. `changed_long` is in that list because a change more than
six months ago is long-standing by any reading.
The copy recommends booking an appointment and does not tell him what is
wrong.

**Layer 3, the constant floor.** Every result, including urgent, carries:

- the statement that this is an educational starting point and cannot
  diagnose any condition;
- a short list of signs that warrant prompt medical attention regardless of
  anything the assessment said;
- the site medical note.

The always-visible urgent list, which is deliberately shown even to someone
whose answers triggered nothing:

- Pain when passing urine, or blood in urine or semen.
- Sudden severe testicular pain.
- Inability to pass urine.
- An erection lasting more than four hours.
- Fever with pelvic or testicular pain.
- A new lump, swelling or change in shape.

## Two free actions per result

Every profile offers exactly two, and both must be doable this week with no
purchase, no account and no app. They come from the published guides, so the
assessment never invents an exercise it has not written up and tested
elsewhere.

## The Blueprint

Appears once, after the education, as the same contextual block the guides
use: the "Build a plan around your goals" heading, the five real features,
the two calls to action, and `$99 one-time access.` It is skippable and it
is never the first thing on a result.

## Accessibility

One question per screen. Each is a `fieldset` with a `legend`, radio inputs
with real labels, 44px targets. Moving between steps sets focus to the new
question's heading and announces progress through a live region. The whole
flow works by keyboard. Nothing depends on color alone.

With JavaScript off the page shows a message naming the guides and linking
to `/learn/`, so a visitor is never left with a dead page.
