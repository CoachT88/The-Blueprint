# The public site: information architecture

The audit behind the October 2026 simplification, and the map the site is
built to now. Written to be read before changing any public page, because
the failure this fixes is not ugliness. It is that a first-time visitor was
asked to make too many decisions before he knew what any of them meant.

## The problem, measured

| Where | Decisions presented | Before |
|---|---|---|
| Desktop header | top-level destinations | **5** plus two dropdowns holding 11 more |
| Mobile drawer | links, all expanded at once | **14**, in five always-open groups |
| Home page | full-width sections | **11** |
| Learn hub | links on the landing view | **26** |
| End of every guide | competing calls to action | **2** |
| The app | competing entrances | **2** (`/how-it-works/`, `/whats-inside/`) |

Nothing on that list was wrong in isolation. Together they meant a man who
arrived from a social post had to read and rank about forty choices before
he could tell whether this site was for him.

## The route inventory

Thirty-one public routes. Role, and the single next step each one owes its
reader.

### Visitor entry

| Route | Role | Next step |
|---|---|---|
| `/` | The one persuasive journey: who this is for, what it does, what it costs | Free assessment, or the price block |

### Self-discovery

| Route | Role | Next step |
|---|---|---|
| `/assessment/` | Five private questions, answers stay in the browser | A goal hub, plus two free actions |

### Free education

| Route | Role | Next step |
|---|---|---|
| `/learn/` | **The front door to education.** Asks the goal question first | One of four goal hubs |
| `/last-longer/` | Goal hub | The app |
| `/stronger-erections/` | Goal hub | The app |
| `/better-sexual-performance/` | Goal hub | The app |
| `/size-enhancement/` | Goal hub, and the honest account of what men report | The app |
| `/daily/` | Repeat-visit incentive: one rotating note from an archive of 30 | Today's note, then a goal hub |
| `/research-lab/` | Optional deeper reference. Evidence, reports, and what is unknown | Back to the relevant hub |
| `/research-lab/manual-techniques/` | The one deep topic published so far | Back to the Lab |
| 16 guide pages | One question each, answered, with a free takeaway | **One** step: the app |

The sixteen guides: `performance-anxiety-erections`, `blood-sugar-erections`,
`hydration-erections`, `cardio-erections`, `weaker-morning-erections`,
`anxiety-or-physical-ed`, `pelvic-floor-premature-ejaculation`,
`finish-quickly-penetration`, `ejaculation-warning-signs`,
`arousal-awareness-practice`, `last-longer-alone-than-sex`,
`hip-mobility-sexual-performance`, `improve-sexual-stamina`,
`breathing-manage-arousal`, `sleep-erections-libido`,
`stay-composed-during-arousal`.

### Product explanation

| Route | Role | Next step |
|---|---|---|
| `/whats-inside/` | **The App.** The single entrance: what it is, what it looks like, what is included, what it costs | Buy |
| `/how-it-works/` | The method, one level deeper. Setup, a session end to end | Back to The App |

### Trust, support, conversion

| Route | Role | Next step |
|---|---|---|
| `/faq/` | Objection handling | Support, or buy |
| `/safety/` | Genuine risk and symptom guidance | Support |
| `/support/` | Access problems, a real person | Email |
| `/welcome/` | Post-payment landing | Sign in |
| `/app/` | The product itself. **Not touched by this work** | — |

## The journey

```
Coach Tee social post
        |
        +--> / ............... hero: one action, one secondary
        |        |
        |        +--> /assessment/ ....... "what should I work on?"
        |        |         |
        |        +---------+--> /learn/ .. "what do you want to improve?"
        |                            |
        |                            +--> goal hub --> guide --> ONE next step
        |                            +--> /daily/ (come back tomorrow)
        |                            +--> /research-lab/ (go deeper)
        |
        +--> /whats-inside/ ... The App
                     |
                     +--> /#get ......... buy
                                 |
                                 +--> /welcome/ --> /app/ sign in
```

Nobody is required to traverse every stage. A purchase-ready visitor reaches
the price from the header in one tap. A reader who only wants an answer gets
it without being sold to mid-article.

## What changed, and what deliberately did not

### Navigation: five destinations to four

**Free Assessment · Learn · The App · Help**, with Sign in secondary and
Get the app primary.

- `How It Works` and `What's Inside` were two entrances to one subject.
  `/whats-inside/` becomes **The App**; `/how-it-works/` stays published,
  keeps its URL and its search equity, and is linked from The App page as
  the deeper read. No redirect, no lost equity, one entrance.
- The mobile drawer is now four collapsible groups. **Start here** is open
  on arrival; the rest are `<details>` a man opens if he wants them. Four
  visible choices instead of fourteen.

### Home page: eleven sections to six

| Was | Now |
|---|---|
| hero | **1. Hero** — unchanged in intent, one primary action |
| daily-note | moved to `/learn/` and `/daily/`; the home page keeps one line |
| why | **2. Recognition** — plus the goal chooser, which resolves it |
| answer, inside, function | **3. The mechanism** — one section, detail behind a disclosure |
| start-free | folded into 2; it was a third parallel funnel |
| look | **4. The app, demonstrated** |
| honest, private, proof | **5. Proof and the objections** — one section |
| get | **6. The offer** |

The size-enhancement honesty block, the privacy block and the testimonial
disclaimer were **not** cut. They were put in one place instead of three,
and the legally load-bearing wording is carried over unchanged.

### Learn: the goal question first

The landing view used to open with the assessment, then a topic grid, then a
daily note, then sixteen article links, then the Research Lab, then a sales
block. It now opens with **"What do you want to improve?"** and four
choices. The sixteen guides are still on the page, one disclosure deeper,
grouped by goal. Nothing was deleted and no URL moved.

### Guides: two next steps to one

Every guide ended with `Explore The Blueprint` *and* `See How The Blueprint
Works`, side by side, equally weighted. A reader who has just been given a
free seven-day plan does not need two sales doors. One remains.

## Rules for anyone editing these pages

1. **One primary action per decision stage.** A second button of equal
   weight is not a choice, it is a delay.
2. **The free thing arrives before the sale.** The guide template enforces
   it: free plan, then medical guidance, then references, then one next
   step. `tests/learnGuides.test.js` fails if that order changes.
3. **Navigation lives in `tools/site-nav.{html,css}`.** Edit there, run
   `node tools/sync-site-nav.mjs`, never edit a page's copy.
   `tests/siteNav.test.js` fails on drift.
4. **No claim without a source.** Community reports are attributed as
   personal experience. No invented gains, rates, testimonials or urgency.
5. **Keep the warnings, lose the lecture.** Specific symptoms, specific
   circumstances, at the point they are relevant. Not a disclaimer at the
   top of a page about hydration.
