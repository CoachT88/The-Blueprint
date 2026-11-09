# The Blueprint — operating standards

Standing instructions for any agent working in this repository. These are not
suggestions; treat them as constraints on how work is done.

---

## Development Efficiency Protocol

**Operating principle: maximum reasoning quality, minimum unnecessary execution.**
The objective is not to perform more work. It is to make the best possible decisions and
deliver reliable results with the least unnecessary effort.

### 1. Agent limits
- **Two concurrent agents by default.** Five is an absolute ceiling, not a target.
- One agent: bug fixes, copy changes, focused reviews, straightforward implementation.
- Two: moderate tasks with genuinely independent research or verification.
- Three to five: only when the workstreams are genuinely independent and the work cannot
  be done sequentially at lower cost.
- Never create an agent to increase parallel activity. Never give two agents overlapping
  assignments. Prefer one capable agent finishing a focused task over several duplicating
  each other.
- **Ultracode stays off** unless its orchestration is clearly justified. The word appearing
  in a message is not a request for it.

### 1a. Model and effort routing

Use the least expensive reliable approach and escalate only when the work demands it.
Never trade correctness for tokens.

| Work | Model | Effort |
|---|---|---|
| Normal implementation: UI, straightforward features, targeted tests | **Sonnet** | medium |
| Narrow, well-defined delegation where handing it off genuinely costs less than doing it | **Haiku** | low |
| Complex debugging, persistence and migration logic, safety-sensitive changes, architectural decisions, hard correctness reviews | **Opus** | high |
| Anything above that | a stronger model or `xhigh`/`max` — only on demonstrated need |

- **Assign explicitly.** Pass `model` and `effort` on every `Agent` call rather than letting
  an expensive default be inherited. Claude Code's own parameters are the mechanism; do not
  build anything to manage this.
- **Start low, escalate on evidence.** If a task needs more reasoning, raise effort or move
  up a model. Do not retry a failing approach at the same setting, and do not add agents
  instead of thinking.
- The session's own model is the user's choice via `/model`; these rules govern delegated
  work and the judgement about whether to delegate at all.
- Safety-sensitive work in this repository means anything touching member data, migrations,
  completion or progression accounting, the pelvic screener, or exercise guidance. That work
  goes to the top row regardless of how small the diff looks.

### 2. Plan before delegating
Before launching anything, state: the actual problem, the customer or business benefit,
what information already exists, what genuinely needs independent investigation, and the
smallest useful deliverable.

### 3. Reuse before building
Inspect the codebase before creating functionality. Prefer existing components, utilities,
tests and infrastructure. Do not rebuild what exists without a demonstrated reason.

### 4. Research efficiently
Start with the strongest sources: primary evidence, independent firsthand reports, relevant
technical documentation. Stop when more research would not change the decision.
**Do not retry sources already established as blocked**, re-investigate settled questions,
or spawn verification agents that add no information.

### 5. Test proportionately
Testing matches the risk and scope of the change.
- Targeted tests during development.
- Full verification before merging, with the exit code read directly, never through a pipe.
- Mutation tests when they meaningfully establish that a critical regression test detects
  the intended defect — not automatically for every small change.
- Do not rerun an unchanged suite without a concrete reason.

### 6. Preserve context and tokens
Give each agent a narrow responsibility and only the context it needs. Do not re-summarise
the project, reopen settled decisions, or write a long report where a short finding does.
Report a finding once, with its evidence and a recommendation.

Specifically avoid: reading the same file twice, repeating research already done, running
the full suite during development when a targeted run answers the question, and reporting
progress that changes no decision. Close with what changed, what was verified, what remains,
and the decision needed — nothing else.

### 7. No scope creep
Do not add unrelated improvements because an opportunity appeared. Record non-critical
findings separately and leave them. Priority order: customer-facing defects, meaningful
reliability and safety concerns, core functionality, revenue.

### 8. Quality is not negotiable
Efficiency never means skipping essential verification, hiding uncertainty, passing over a
meaningful safety concern, or calling incomplete work done. Reduce redundant effort, not
necessary effort.

### 9. Report decisions, not activity
Close every task with: what was accomplished, what was verified, what is uncertain or
blocked, and what decision or approval is needed next. Skip progress narration unless a
finding changes direction.

---

## Verification discipline

- **Commit and verify the working tree before testing.** Never switch branches while a test
  run is active. Every reported result must be traceable to an exact commit.
- Read a suite's exit code directly (`npm run test:all > log 2>&1; echo "EXIT=$?"`), never
  through a pipe.
- CI has two workflow runs per commit. **Read results by job ID**; the push-triggered run
  reports Browser suites as `skipped`.
- A regression test must fail against the unfixed code. A test that passes before the fix
  proves nothing.
- **Pre-flight before a full run.** Find direct and indirect dependencies first: changed
  symbols, shared arrays and indices, exercise step counts, and copy that tests assert on.
  Browser tests inspect the page rather than import modules, so search `tests/` and
  `tests/e2e/` for each touched name and string, not only the imports. Run the matching test
  files, fix what fails, commit, then run the full suite once on the final implementation.
  A documentation-only change does not void a valid run; any application or test change does.

## Claim standards

**Lead with what The Blueprint helps members accomplish, not what it doesn't do.**
Describe each exercise and feature by its purpose, its experience and the progress a member
can track. Do not open with, or repeat, what something cannot achieve. Keep essential
safety instructions, stop signals and material limitations clear and say them once, where
they matter; unnecessary disclaimers must not dominate the experience. This applies to the
whole product, and it never licenses an unsupported outcome promise.

Member-facing copy and exercise guidance must not:
- state a proposed mechanism as an outcome, or present a sensation as evidence of adaptation;
- publish a figure, rate or percentage without pointing at what measured it;
- instruct a member toward a maximum with no ceiling other than pain onset;
- imply a screener diagnoses anything, or that passing one is clearance.

Evidence tiers stay separate: what a method is *intended* to do, what users *report*, and
what has been *measured* are three different claims. Where the product guides a physical
technique, the stop signal belongs in `dontFeel` — one specific, early, actionable line at
the point of action, not a paragraph of disclaimers.

Uncertainty is not danger, and limited research is not disqualifying. Decisions are
proportionate to risk, assessed per technique.
