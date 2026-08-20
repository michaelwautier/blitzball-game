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
- **Restarts:** each half opens with a blitzoff — the ball loose at the centre spot with a
  little scatter, both sides racing. After a goal it is not a race: the side that conceded
  restarts with the ball on the spot, everyone else behind their own kickoff line.
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
  underdogs improve while the league stands still. See the open question in Phase 6.
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

Not done — carried into Phase 6:
- Free-agent pool with salaries and contracts.
- Prize money economy.

### Phase 5 — The FFX screen & flow (next, ordered)
Planned from the user's FFX captures on 2026-08-21: the HUD moves to FFX's layout, and the
encounter flow adopts FFX's breakthrough semantics. Five PRs, in this order — cosmetics that
cannot break anything first, then gameplay changes one at a time so each can be measured
against the ladder alone.

1. **FFX HUD layout** ✅ (#30). Radar to the bottom-right with `TIME` and the score stacked
   beneath it; the event line ("Kulukan on defense!", one per engaged defender) to the
   bottom-left; the debug overlay directly above it; the encounter menu to the top-left,
   compacted into an FFX-style titled box with each option's detail under its label. Break
   options are named — "No Break / Break to Deim / Break to Deim & Vuroja" — cumulatively and
   nearest-first, matching the order they are actually challenged in. The emphatic goal banner
   stays centred.
2. **The conceding team takes the restart** ✅ (#31). After a goal, `resetForKickoff` hands the
   ball to `opponentOf(scorer)`'s MF on the centre spot instead of racing a scattered loose
   ball — the scorer winning that race half the time was a compounding unfairness, since play
   clusters wherever the ball lands. Each half still opens with the neutral scatter, which is
   the blitzoff. It compressed the extremes as intended: see *Balance*.
3. **The FFX breakthrough flow** ✅ (#33). Breaking past defenders is a *step inside* the
   encounter rather than a bundle on the throw: `breakthrough` takes a depth (challenge the
   nearest k), clearing everyone resumes play, clearing some keeps the encounter open against
   the rest — who alone block whatever is thrown next. Pass and shoot lost their bundled
   break-past and go straight to target/technique, so the menu has fewer steps than before.
   There is no route back to open play while a defender is still engaged. The AI gets two-step
   play for free by re-deciding each think-tick. Measured: scoring held at 2.4 goals a match
   and breaking did not become dominant (12.2 breaks against 20.6 shots a match), though the
   already-thin tails thinned further — see issue #25.
4. **Top-right stat stack, and HP drains while carrying** ✅ (#34). The FFX panel: the
   carrier's name and effective `HP EN PA SH` — whichever side has it — plus one row per
   engaged defender (`HP AT BL`, taken from the encounter's own snapshot, so the panel shows
   the numbers that actually get rolled). Carrying now drains HP at `CARRY_DRAIN_PER_SECOND`
   rather than merely forgoing regen, floored at zero so exhaustion stays the penalty.
   Measured at 0.5/s: costs about 0.12 goals a match, with shots and encounters unmoved, so
   stamina matters without distorting anything.
5. **Encounter staging and camera** ✅ (#35). Engaged defenders glide — via the existing lunge
   mechanism, so it is watched rather than applied — into a line between the carrier and the
   goal being attacked, fanned so two defenders read as two bodies. The camera closes in while
   the menu is open. Lunges now advance during an encounter, which also fixes a defender
   hanging motionless mid-lunge after a partial break. Measured: 2.27 to 2.37 goals a match
   with encounters unmoved. Labels became distance-scaled in the same change, since the closer
   camera turned a nearby player's name into a quarter of the screen.
6. **Arrow-key selection** ✅ (#36). Move through the encounter options with the arrows and
   confirm with space or enter, with an FFX cursor marking the choice. Hovering moves the
   highlight too, so mouse and keyboard never point at different rows. It wraps at both ends
   and skips options that cannot be chosen — an unaffordable technique stays visible, because
   that is information, but holding an arrow never gets stuck on it. The number keys are gone
   rather than kept as a shortcut: they were redundant the moment this existed, and the row
   chips were noise in a box that had just been narrowed. UI only.
7. **Make defending feel like defending** ✅ (#37). The complaint was exact: glued to an
   opponent, waiting seconds for anything to happen. The cause was that `engageCooldown` is a
   single global timer blacking out every encounter in the pool for four seconds after any
   pass — and that attacking had an override defending did not, since `requestActionMenu` (the
   space bar) never consulted it.
   Defending gets the same key: off the ball it challenges the carrier, bypassing the global
   grace exactly as stopping to look up always has. That grace paces what the game does *by
   itself*; it should never have decided what a person is allowed to do.
   The per-defender cooldown proposed alongside it was **tried and largely rejected by
   measurement**. Replacing the global grace with it saturated encounters at 177–246 a match
   even at eleven seconds each — five outfielders a side is too deep a bench — and it punished
   weak defences hardest, taking Besaid from 124:329 to 52:379. It survives only at two
   seconds, short enough never to bind on the engine, for the one job it is good at: stopping
   a person mashing the challenge key. With the global grace restored the ladder is identical
   to #35's, which is the point — the fix is a new option, not a change to the game's pacing.
8. **A throw flies to where it was aimed** ✅ (#39). Fidelity, not taste: this is how the
   original behaves. Power is no longer drained continuously in flight — a throw covers its
   whole distance and decay is charged on arrival — so nothing can die halfway and be picked up
   by whoever happens to be standing there. That was reading as an interception by a defender
   who, by the rules, cannot intercept. A throw that arrives spent is fumbled *at the
   receiver*, and the ball then travels on to whoever collects it as a second leg with nothing
   to contest, so the turnover is watched rather than teleported. Nobody swims while the ball
   is in the air, as in FFX, though the clock runs and a committed lunge still plays out.
   `FLIGHT_SPEED` is down a third, which the ladder says is free.
   The freeze is not free, and the cost is worth knowing: goals fell from 2.37 to 1.92 a match
   and goalless fixtures rose from 31% to 42%, because defenders no longer drift out of shape
   while the ball travels. It also reordered the league — the Ronso went from third to first,
   being the slowest side and therefore the one that lost least by nobody being allowed to
   move. Measuring at the *old* flight speed gives the same 1.92, so this is the freeze, not
   the slowdown. Winding scoring back toward 2.4 is a tuning question for its own PR rather
   than something to smuggle into a fidelity change.
9. **A bigger pool and a closer camera.** Two constants, but not a free change:
   `POOL_RADIUS` scales `ENGAGE_RADIUS`, both decay rates and `SHOOTING_STANDOFF` — the three
   most sensitive numbers in the game. Ladder before and after, and tuned back to roughly 2.4
   goals a match rather than accepting whatever falls out.
10. **Team strategies.** The first genuinely tactical decision the user gets. Each side plays a
    defensive shape with real trade-offs — pressing commits everyone to the carrier and leaves
    the passing lanes open; zone holds shape and concedes the carrier room; man-marking sits
    between — and can switch mid-match to answer what the other side is doing. Mechanically
    this is `CHASERS` and `markingSpot` in `positioning.ts` becoming strategy-driven rather
    than constant. Each team gets a default that suits its squad: the Guado's blocking suits a
    zone, the Ronso's attack suits pressing. Needs a ladder pass *per strategy* to show each is
    viable rather than one being strictly best, which is the whole point of having them.

### Phase 6 — Squads & recruiting (after Phase 5, unordered)
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

Giving the restart to the side that conceded (#31) was measured the same way, and did what a
comeback mechanism should — it compressed the extremes without reordering the table:

```
             before        after
PSY  conceded      6           32
BES  conceded    341          304
BES  scored      113          124
goalless         27%          27%     (2.46 goals/match)
```

Holding every player still while the ball is in the air (#39) cost about a fifth of all goals
and reordered the table, which is a reminder that a rule taken purely for fidelity can be a
balance change in disguise. It stands because the original behaves that way; whether to wind
scoring back up is a separate decision.

The most sensitive numbers, in order: `SHOOTING_STANDOFF`, `SHOT_DECAY_PER_UNIT`, and the
blocker coverage weights. Small moves in any of them swing the whole board — change one at a
time and re-run the ladder.

Two known problems live in the issue tracker rather than in this file. **#25**: Kilika and the Guado barely score, and the Guado went a
full simulated season without a single goal. It is faithful to the data — neither side has a
shooter, and the Guado have no shot techniques at all — so it is filed rather than tuned away.
**#32** is worse: the two ends of the pool are not worth the same. Over sixty mirror matches
Luca win 17 and lose 38 at the home end while Besaid win 49 and lose 6 at that same end. It
predates any of Phase 5 and may be an artefact of how `simulateMatch` drives the user's side
differently from the engine's, rather than a fault in the game itself — that is the first
thing to establish. The league and the ladder both play every pairing at each end, so neither
the table nor the tuning conclusions are invalidated.

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
