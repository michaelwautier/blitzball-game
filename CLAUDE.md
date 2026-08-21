# Working on this project

## Keep PLAN.md current

`PLAN.md` is the shared picture of where this project is: the decisions taken, the rules being
recreated, the architecture, the phase markers and the balance notes.

**Update it in the same change that falsifies it** — a phase shipping, a decision being
overturned, a formula or constant moving — rather than leaving it to drift and be corrected
later. Before opening a PR, check whether it contradicts anything in there.

A plan that disagrees with the code is worse than no plan.

## Balance is measured, not guessed

Every constant that affects play lives in `core/encounter/formulas.ts` or is exported and
documented where it is used.

**Run `npm run ladder` before and after any change that could affect play.** It plays all
thirty league pairings at both ends, ten times each, with the real engine and the real AI, and
prints a table plus the goal, goalless, encounter, shot and break rates. Quote both readings in
the PR — a measurement nobody can compare against is not a measurement. It is skipped by
`npm test`, so it costs CI nothing and has to be asked for.

Change one constant at a time — `SHOOTING_STANDOFF`, `SHOT_DECAY_PER_UNIT` and the blocker
coverage weights each swing the whole board.

Measure the premise too, not just the result. Three of the changes that mattered most were
justified by counting what the old code actually did first — a third of the AI's passes could
not physically arrive — and one proposed fix was thrown out because the ladder said it made
things worse.

## The core stays pure

`core/` must not import from `render/` or `ui/`. That separation is what made the 3D swap a
renderer change with no effect on gameplay, and what lets the league simulate its own fixtures
with the identical engine.

## One dev server, ever

Before starting `npm run dev`, check for one already running (`pgrep -fl vite`) and reuse it —
or kill it and start fresh. Never leave more than one. Background-started servers outlive the
conversation that started them; four were once found quietly accumulated across sessions.
