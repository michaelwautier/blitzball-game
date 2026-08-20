# Blitzball — Browser Proof of Concept

A faithful recreation of Final Fantasy X's Blitzball minigame, playable in the browser.
Fan project for personal use, using authentic FFX teams, players, and stats.

> **Keep this file current.** It is the shared picture of where the project is. When a phase
> ships, mark it; when a decision is overturned, rewrite the decision rather than leaving the
> old one standing. A plan that disagrees with the code is worse than no plan.

## Decisions locked in

- **Fidelity:** Faithful hybrid — real-time swimming with the ball, pause-and-menu encounters
  when defenders engage, stat-vs-stat resolution with randomization like the original.
- **View:** 3D. A broadcast camera close to the water, following the player you control, with
  the pool laid out below it. The original top-down Canvas view survives as a semi-transparent
  radar in the corner, because a camera inside the pool cannot show you shape or marking.
- **Stack:** Vite + TypeScript. `three` for the 3D scene, a hand-rolled Canvas renderer for the
  radar, and a hand-rolled fixed-timestep loop. No game framework, no UI framework.
- **Rosters:** All six FFX teams (Besaid Aurochs, Luca Goers, Al Bhed Psyches, Ronso Fangs,
  Guado Glories, Kilika Beasts), with level-one stats and growth curves transcribed from FFX's
  own per-level tables.
- **Scope:** Full loop — match, techniques, levelling, league. All four now exist; recruiting
  is the remaining ambition.

## Game rules being recreated (reference)

Where this section and `core/encounter/formulas.ts` disagree, the code is right and this is
stale — fix it.

- 6 players per side: LF, RF, MF, LD, RD, GK. Two halves on a countdown clock
  (FFX uses 5:00 halves; ours are 3:00, `HALF_SECONDS` in `core/match/state.ts`).
- Player stats: **HP, SP** (swim speed), **EN** (endurance/dribble), **AT** (attack/tackle),
  **PA** (pass), **BL** (block), **SH** (shoot), **CA** (catch, mainly keepers).
- Free play: the ball carrier is user-controlled; teammates and opponents are AI-positioned.
  Three defenders break off to close the carrier down; **at most two may engage them at once**
  (`MAX_ENGAGED`), the third being cover rather than a challenge.
- **Encounter:** when defenders reach the carrier, the game pauses and shows the menu —
  Breakthrough, Pass, or Shoot, plus a choice of how many defenders to clear first and which
  technique to spend HP on. Defenders spend a different stat depending on what you chose:
  - *Breakthrough:* carrier EN vs each defender's **AT** roll, in turn. EN survives → swim
    past; EN hits 0 → the defender who took it there wins the ball.
  - *Pass:* PA reduced by each engaged defender's **BL** roll, then decays with distance.
    Reaching 0 mid-flight is a turnover, not a loose ball — the intended receiver fumbles it.
  - *Shoot:* SH reduced by **BL** rolls and distance decay, then by the keeper's **CA**.
    Anything still standing is a goal.
  - *Clearing first:* endurance spent getting past a defender is blocking that never gets
    counted against the throw. The trade FFX offers, and the AI takes it.
- **Rolls.** A *defending* stat is rolled at **0.5–1.5×** its value and subtracted; the
  attacking stat is used at face value, so the uncertainty lives in the challenge. Two
  deliberate exceptions, both documented at length in `formulas.ts`:
  - The **keeper's catch** rolls on a wider **0.2–2.0×** band over a floored value
    (`CATCH_FLOOR + CA × CATCH_PER_POINT`). A save happens once and alone and decides the
    scoreline; the ordinary band made four of the six keepers unbeatable and two of them
    useless.
  - The **second blocker counts half**. Two bodies do not block twice as much of an open ring.
- **Techniques:** actions cost HP; techs (Venom Pass, Nap Shot, Sphere Shot, Jecht Shot…)
  cost more for bonuses and status effects (poison, sleep, wither). HP regenerates slowly when
  swimming without the ball; a player at 0 HP acts at half effectiveness.
- **EXP/Levelling:** every contested action grants EXP; levels raise stats along per-player
  growth curves. Only the user's squad has careers — the AI sides stay at level one, so the
  underdogs improve while the league stands still. See the open question in Phase 5.
- **League:** double round-robin among the 6 teams, 3 points for a win and 1 for a draw,
  standings table. The fixtures you are not in are played out by the same engine, headlessly.

## Architecture

```
src/
  core/            # deterministic simulation — no DOM, no Canvas, no three.js
    match/         #   state machine, clock, movement, possession, ball flight, stats
    encounter/     #   encounter trigger + resolution math; formulas.ts holds every constant
    ai/            #   positioning, defender convergence, AI encounter decisions, autopilot
    league/        #   fixtures, standings, season, headless simulation, save/load
    progression/   #   EXP awards, level curves, stat growth, Squad
    pitch.ts       #   pool geometry — one source of truth for every distance
    loop.ts        #   the fixed-timestep loop itself
    rng.ts         #   seedable RNG so matches are replayable/testable
  data/            # teams.ts, techniques.ts, types.ts — rosters as plain data
  render/          # scene-renderer.ts (three.js), renderer.ts (the radar), projection.ts
  ui/              # DOM overlays: encounter menu, scoreboard, summary, league screen
  input/           # keyboard mapping
  main.ts          # fixed-timestep loop, and the league ⇄ match flow
```

Key principle: **the sim core is pure and deterministic** (seeded RNG, fixed timestep) and
never imports from `render/`. This is what made the 3D swap a renderer change with no effect
on gameplay, and what lets the league simulate its own fixtures with the identical engine.

Match state machine: `play ⇄ encounter → flight → play | celebration → play → halfTime → … → fullTime`.

## Phases

### Phase 0 — Scaffold ✅ (#1)
Vite + TS, fixed-timestep loop with interpolated rendering, Canvas pool, debug overlay,
seedable RNG, CI running typecheck/tests/build on every PR.

### Phase 1 — Playable single match ✅ (#2, #3)
Rosters, formation-based positioning, defender convergence, keeper positioning; the encounter
system with its menu and resolution math; ball flight, goals, clock, halves, kickoffs and an
end-of-match screen; an AI opponent making the same decisions through heuristics.

### Phase 2 — Techniques & HP ✅ (#4)
HP as a spendable resource with slow regen; eight techniques with poison, sleep and wither;
per-player technique lists; stamina rings and condition markers.

### Phase 3 — EXP & levelling ✅ (#9)
EXP per contested action, level-up along per-player growth curves, and a full-time summary
showing what everyone earned and what it bought. Careers live outside the roster data, so a
match is built from a snapshot of current stats and the engine never learns progression exists.

### Interlude — the game it actually needed to be ✅ (#5–#21)
Not planned as a phase, but larger than most of them. Keepers distribute rather than dribble
(#5); stopping on the ball at will (#6); FFX's real stats and its pass/shot formulas, with BL
replacing AT as the defending stat for throws (#13); the 3D swap with radar, broadcast camera
and a bigger pool (#14, #18); breakthroughs resolved as one tackle per defender, with beaten
defenders carried past and briefly out of the play (#11, #16, #19); a minimum shooting
distance (#15); choosing how many defenders to clear before throwing (#20); and defending
made a decision, with its own choice of tackle technique (#21).

### Phase 4 — League 🟡 mostly done
Done:
- **All six teams** with real level-one stats and growth curves (#22). Positions and technique
  lists are ours — FFX fixes neither — and are marked as such in `data/teams.ts`.
- **A scoring rework** (#24), which the six-team ladder made unavoidable. See *Balance* below.
- **The league** (#26): double round-robin, standings derived from results rather than
  accumulated, and `simulateMatch` moved out of the tests into `core/league` where it belongs.
- **The league on screen, and saves** (#27): the game opens on a table, plays your fixture,
  resolves the round around it, and survives a reload.

Not done — carried into Phase 5:
- Free-agent pool with salaries and contracts.
- Prize money economy.

### Phase 5 — Squads & recruiting (next, unordered)
No order chosen yet. The candidates, roughly by size:

- **Squad and lineup control.** Today the lineup is fixed by a stat-profile guess in
  `data/teams.ts` and you cannot change it. Being able to pick who plays where, see levels and
  stats, and rest tired players is the smallest thing that gives you decisions between
  matches — and recruiting means little without it.
- **Free agents and contracts.** The 23 free agents from the source data, with salaries and
  contract lengths in matches, plus the prize money to pay them. The roster is transcribed and
  ready; this needs somewhere to put a signing, so it probably wants lineup control first.
- **Careers for the AI sides** (issue #25). Only your squad levels up, so the league stands
  still while you improve. Fixing that would keep later seasons competitive, and is the most
  likely cure for the toothless teams below.
- **Play it and fix what grates.** All balance so far was tuned by simulation, which says
  nothing about how a half *feels* — encounter frequency, camera, menu pacing, match length.

## Balance

Balance is measured, not guessed. `core/league/simulate.ts` plays a match headlessly with the
real engine, and a scratch ladder over all thirty pairings is the instrument used whenever a
formula constant moves. Before #24 that ladder read:

```
PSY 532:0   RON 310:20   GUA 460:6   LUC 389:86   KIL 2:337   BES 11:1255
```

Four sides never conceded; the Aurochs won nothing. The cause was not the keepers but the
crowd: three defenders engaged every carrier, blocking and tackling both sum across everyone
engaged, and a level-one carrier had no route out of that arithmetic. Capping engagement at
two, halving the second blocker, having the AI clear defenders before throwing, and flooring
the keeper's catch turned it into a league the Aurochs can compete in.

The most sensitive numbers, in order: `SHOOTING_STANDOFF`, `SHOT_DECAY_PER_UNIT`, and the
blocker coverage weights. Small moves in any of them swing the whole board — change one at a
time and re-run the ladder.

Known tail, tracked as issue **#25**: Kilika and the Guado barely score, and the Guado went a
full simulated season without a single goal. It is faithful to the data — neither side has a
shooter, and the Guado have no shot techniques at all — so it is filed rather than tuned away.

## True volumetric 3D, if it is ever wanted

The presentational 3D swap is done: the simulation still runs on a 2D plane and the scene
renders that plane. Making depth *real* — players swimming above and below each other, height
affecting passes, shots and blocks — remains a separate, expensive step: `Vec2` → `Vec3` in
`core/pitch.ts` and a z-term in every distance that feeds decay and encounter proximity. The
encounter resolution itself is stat-based rather than physics-based, so the formulas would
survive, but it touches AI positioning and every formation, and it makes the game harder to
read and control. Funnelling distance calculations through `core/pitch.ts` rather than
inlining `Math.hypot` is the discipline that keeps the option affordable.

## Risks & notes

- **Exact FFX formulas** aren't officially published; community documentation is good but
  approximate. Every constant is isolated in `core/encounter/formulas.ts` with unit tests
  locking in expected behaviour, so tuning stays one file.
- **The league does not grow with you.** Only your squad has careers. Pleasant for a first
  season, a problem by the third.
- **Rosters and stats are transcribed from FFX** — fine for a personal fan project; swap to an
  original cast before any public release.
