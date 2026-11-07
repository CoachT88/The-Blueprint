# The Blueprint — operating standards

Standing instructions for any agent working in this repository. These are not
suggestions; treat them as constraints on how work is done.

---

## Development Efficiency Protocol

**Operating principle: maximum reasoning quality, minimum unnecessary execution.**
The objective is not to perform more work. It is to make the best possible decisions and
deliver reliable results with the least unnecessary effort.

### 1. Agent limits
- **Never run more than five agents concurrently.** Use the fewest that do the job.
- One agent: bug fixes, copy changes, focused reviews, straightforward implementation.
- Two or three: moderate tasks with genuinely independent research or verification.
- Four or five: only when the workstreams are genuinely independent.
- Never create an agent to increase parallel activity. Never give two agents overlapping
  assignments.

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

## Claim standards

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
