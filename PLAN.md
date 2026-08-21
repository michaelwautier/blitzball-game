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
9. **A bigger pool and a closer camera** ✅ (#50). `POOL_RADIUS` 110 → 150, and the camera
   stand-off cut from 0.30/0.58 of the pool to 0.18/0.34. Those are one change, not two: the
   stand-off is a fraction of the pool, so enlarging the pool alone walks the camera away from
   players who have not grown. It now sits closer to them in absolute terms than it ever did at
   the old size — 27 and 51 units against 33 and 64.
   Not free despite everything scaling, because the goal mouth and the bodies do not: the same
   shot has a relatively smaller target, and the pool takes more crossing per point of pass
   range. Goals fell 2.40 → 2.14, and `SHOT_DECAY_PER_UNIT` 0.47 → 0.468 brought them to 2.49.
   The table order is identical to before at both ends of that. Besaid gain 55 points, the
   Guado and Kilika lose about 18 each.
   The third digit is not false precision. At this size 0.470 gives 2.14 and 0.468 gives 2.49 —
   most of the range lives in that fifth of a hundredth, while 0.468 down to 0.460 only carries
   it from 2.49 to 2.63. Shots arrive with single digits of power against a keeper's catch, so
   a small change in what survives the journey tips a whole population across the line at once.
   Re-measure rather than interpolate.
   Two tests had distances pinned in raw units and so quietly stopped asserting anything at the
   new size — a point "outside the pool" at 110 is comfortably inside it at 150. Both are
   fractions of the radius now.
11. **Camera: follow what matters, and behave the same everywhere** ✅ (#40). Pulled forward
    out of order, being bugs plus a small feature rather than the balance-affecting resize in
    9.
    The camera trailed in depth by a *damped* fraction, so at the far edge of the pool it ended
    up level with the player and they left the frame. It now trails by the same stand-off in
    the same direction from anywhere in the pool — which means at the edge it sits outside the
    sphere looking in, and that is fine: checked on screen, the water renders perfectly well
    from outside. The obvious repair instead, retreating towards the middle, is far worse than
    the bug, because it swings the camera round to the other side of the player and inverts the
    controls mid-swim. Sameness of behaviour beats any framing.
    The camera also follows **the ball** while it is in the air, rather than the player who let
    go of it, and **a teammate being considered for a pass** while that choice is open.
    The preview felt expensive and is not: a preview frame measures *cheaper* than an ordinary
    one, at 0.045ms against 0.074ms. What it is, is slow — a second and a half to arrive, so
    arrowing down a list leaves the camera sliding. A quicker ease for menu selections was
    tried and rejected on taste: the long sweep across the pool is worth more than the
    promptness. Kept as a single ease for everything.
10. **Team strategies.** The first genuinely tactical decision the user gets. Each side plays a
    defensive shape with real trade-offs — pressing commits everyone to the carrier and leaves
    the passing lanes open; zone holds shape and concedes the carrier room; man-marking sits
    between — and can switch mid-match to answer what the other side is doing. Mechanically
    this is `CHASERS` and `markingSpot` in `positioning.ts` becoming strategy-driven rather
    than constant. Each team gets a default that suits its squad: the Guado's blocking suits a
    zone, the Ronso's attack suits pressing. Needs a ladder pass *per strategy* to show each is
    viable rather than one being strictly best, which is the whole point of having them.
12. **The menu follows the ball** ✅ (#42, fixing #41). Found by playing, and invisible to
    every test and every simulated season: the menu reset its step when the *defenders*
    changed but never when the **carrier** did, and it stays open across a turnover because we
    are asked how the defence challenges. So a half-finished question about your own carrier —
    a list of pass targets — survived possession flipping and was re-rendered against the
    opponent now on the ball, offering *their* teammates as receivers. The engine refused those
    answers, correctly, and Escape only stepped back to an action list for the same wrong
    carrier, so there was no way to confirm and no way out.
    The fix is one idea: a step belongs to an encounter, and cannot outlive it. `restart()`
    asks the new encounter's own opening question, and is called whenever the carrier changes
    as well as whenever the menu opens; while the defence is being asked, the defence is the
    only question there is. All four regression tests were checked against the old code first
    — one of them originally passed there, guarding nothing, and was sharpened until it
    reproduced the trap the way a player reaches it.
13. **Passes you can actually complete** ✅ (#43). The user could not work out why their passes
    kept failing. The answer was arithmetic nobody was ever shown: PA is a passing *range*, the
    engaged defenders' BL comes off it first, and at level one BL routinely exceeds PA outright.
    Wakka passes at 3; a single defender blocking at 5 rolls 3–8 against him, so while he is
    held **his passing range is zero** — every teammate on that list was a guaranteed fumble,
    and the menu offered them all identically.
    `passRange` (the inverse of `passDecay`) and `passReach` are the new shared truth. Target
    rows now read *in range* / *at the limit* / *out of range*, and an unreachable one is toned
    as the giveaway it is — but still choosable, because throwing one away to clear your own
    half is a real decision.
    The AI was doing the same thing far more often, and this is what measurement was for:
    across 300 matches **3402 of its 10592 passes — a third — could not arrive even in the best
    case**. `bestPassTarget` now filters on reach rather than merely preferring nearby, using
    the *best* case so it rules out the impossible and leaves the gambles alone.
    Ladder cost, and it is the honest kind: 2.00 → 1.89 goals a match, goalless 39% → 42%,
    breaks 11.6 → 15.9 as a blocked passer takes the defender on instead. Those lost goals were
    coming from free turnovers both sides were handing each other; the table order is unchanged.
    Filtering on the *expected* case instead was tried and rejected — 1.71 goals a match, and it
    dropped the Ronso from second to third for no gain in honesty.
14. **Control follows the throw** ✅ (#44). Requested: when the opposition pass or shoot, be
    given the defender nearest the ball rather than left behind on whoever was being chased.
    Control is otherwise sticky on purpose — reassigning every tick is what made defending feel
    like something happening to you (see 7) — so this is one deliberate exception, and it is
    the moment that earns it: play stops dead while the ball travels, and the contest has
    plainly moved to the far end of it.
    Control goes to whoever can meet the ball's *destination*, not the ball: chasing the player
    who let go of it is chasing nothing. Only their throws, never yours. A fumbled throw starts
    a second leg towards whoever gathers it, and control follows that too, so it is already on
    the player about to have the ball. Safe to recompute every tick because nobody swims while
    the ball is in the air — the answer cannot change until it lands.
    Ladder: 1.89 → 1.96 goals a match, goalless 42% → 39%, table order unchanged. It touches
    only the user's side, which is the home side in every simulated fixture, so it is worth
    watching against **#32** rather than assumed neutral.
15. **Scoring back to where it was** ✅ (#46). The debt #39 left: freezing the pool while the
    ball is in the air cost a fifth of all goals, 2.37 → 1.92, and the note said winding it
    back was a tuning question for its own PR. This is that PR, and it is also the prerequisite
    for the resize in 9, which is specified as "tuned back to roughly 2.4" — you cannot tune
    back to a figure you are not starting from.
    `SHOT_DECAY_PER_UNIT` 0.5 → 0.47. Over 600 fixtures: **1.93 → 2.46 goals a match**, goalless
    40% → 35%, with the table order and spread unchanged.
    Three levers were swept before choosing. `SHOOTING_STANDOFF` is unusable as an aim: 0.18
    gives 5.76 goals a match and 0.26 gives 0.98, from 0.22's 1.96. The blocker coverage weights
    reach 2.25 and then saturate — 0.35, 0.3, 0.25 and 0.2 all land within 0.03 of each other —
    and on the way they redistribute strength between the sides, costing Besaid a quarter of
    their points. Shot decay was the only one that moved the rate and nothing else.
    Honest about the cost: it helps the Guado a great deal (207 → 240 points, and 35:41 becomes
    88:48, so they finally score) and hurts Kilika, who concede 308 → 470 while scoring 6 → 8.
    Lowering the decay lets everyone score, and Kilika have no defence to stop anyone. Both
    halves of **#25** move, in opposite directions.
    `LADDER_RUNS=20 npm run ladder` was added for this: every number above is the 600-fixture
    reading, not the 300 the sweep was done on, because a balance constant should not move on
    one seed family.
16. **A pool that takes crossing** ✅ (#51). Reported after playing #50: still arriving at goal
    far too fast. It was not the size, and no size would ever have fixed it. `maxSpeed` scaled
    with `POOL_RADIUS` *exactly*, and the note above it said so as an achievement — "crossing it
    still takes the same few seconds". It did: **8.1 seconds at radius 50, 110, 130 and 150
    alike**. Three enlargements in a day changed nothing about the one thing being complained
    about, because traversal time was never a function of the pool.
    `SWIM_SCALE` makes that exponent explicit and sets it to 0.5. Goal to goal goes from 7.4
    seconds to 12.9. At 1 the pool cannot be made to feel bigger; at 0 a resize would retune the
    whole game by stealth, which is what the scaling existed to prevent. Half power keeps the
    guard and drops the trap.
    **`HALF_SECONDS` 180 → 300 comes with it**, and is FFX's own figure — ours was shortened to
    keep a demo brisk. Slower swimming leaves a three-minute half with a quarter less football
    in it: 20.8 shots a match down to 15.6, goals to 1.63. Five minutes puts both back and more,
    at 26.3 shots and 165 encounters against 101, with goals at 2.59.
    Measured separately before being shipped together: swim alone is 1.63, swim plus the longer
    half is 2.59. A gentler 0.65 was also run and rejected — 2.81 goals, and less of what was
    asked for.
    Longer matches take luck out, which costs the weakest side. Besaid's points fall by a third
    while their goals conceded *per minute* slightly improve: with twice the goals in a match,
    fewer are decided by one. The table order is unchanged.
    Side effect worth having: `POOL_RADIUS` is now a real lever on traversal time rather than a
    purely visual one. At half power, doubling the radius makes crossing take about 1.4× as long.
17. **A breakthrough you can watch** ✅ (#53). Reported from play, from a screenshot: a
    breakthrough was attempted, the ball was lost, and the next thing on screen was a "how do
    you challenge?" menu with nothing to say what had gone wrong. Three faults in one moment.
    **The tackles landed together.** Both rolls happened inside the tick that committed them and
    were reported as one line — `EN 14 − 6 − 5 = 3`. Correct, and unreadable. A new `challenge`
    phase queues the defenders and takes them in turn, `TACKLE_BEAT` apart, naming each one as
    they are gone past. The order is the one the menu named and the one the rolls always used;
    only the pacing is new.
    **The endurance jumped.** It went from full to spent between two frames. `state.endurance`
    now follows the run down, so there are three readings across two defenders rather than two.
    **Play stopped afterwards.** `pushPastCarrier` charges recovery to defenders and
    `chargeCommittedDefenders` charges a cooldown to defenders — nothing was ever charged to the
    carrier who *lost the ball*. So the dispossessed player kept full agency and could challenge
    back on the next frame, and the space bar that confirms a breakthrough is the same one that
    challenges. `DISPOSSESSED_RECOVERY` fixes it: beaten is beaten, whichever end of the
    challenge you were on. Losing the ball now returns to open play with the winner swimming
    off, and the event marked rather than interrupted.
    The camera holds its encounter close-in through the challenge, which is the part worth
    watching.
    Ladder, 600 fixtures: **2.59 → 2.61 goals a match**, goalless unchanged at 34%, table order
    unchanged. Two accidents were caught by measuring rather than assuming, both worth recording.
    Charging the committed defenders on the tick that *starts* the challenge rather than when it
    lands weakens every defence that a partial break hands the encounter back to — bit-identical
    on the ladder as it happens, because a beaten defender's recovery already covers it, but
    wrong. And separating bodies during the challenge freeze, which the encounter freeze
    forbids, was worth 0.17 goals a match on its own.
18. **Knowing where play is** ✅ (#54). Two halves of one complaint: defending with a player
    far from the ball, you cannot see what you are defending against.
    **An encounter now takes control with it.** The menu asks how *your* defence is challenging,
    and the camera follows whoever you are steering — so being asked that while looking at a
    player nowhere near it is being asked to decide blind. It happens because control is sticky
    by design (see 7), and the defender who closed the carrier down is very often not the one
    you were swimming. `focusOnEncounter` hands control to a defender who is actually in it,
    nearest first, matching the order the menu names them. It only ever moves control *into* a
    confrontation, never out of one.
    **An off-screen ball gets an arrow**, riding the edge of the frame on its true bearing, in
    the carrier's colour, with the distance *you* have to swim rather than the camera's.
    Zooming out to fit was considered and rejected on geometry: the pool is 276 units goal to
    goal against a 51-unit camera stand-off, so fitting both at the extremes reduces everyone to
    specks — and variable framing is the family of change that produced the inverted-controls
    problem in 11. The close camera was asked for twice; it should not quietly undo itself
    whenever play stretches.
    The projection maths is pure and tested, `render/off-screen.ts`. The case worth knowing:
    a perspective projection mirrors whatever is *behind* the camera through the origin, so a
    carrier directly behind you projects to the middle of the frame and reads as visible and
    dead ahead. Two of the seven tests are about that.
    Ladder: 2.61 → 2.58 goals a match, table order unchanged — the focus change moves which
    player the simulation steers, which is why it was measured at all.
19. **The keeper, while you are deciding to beat them** ✅ (#55). The stat panel showed the
    carrier and whoever was on them, and the menu's odds stop at those defenders — so the one
    number that actually decides a shot, the catching behind them, appeared nowhere at all.
    A keeper row now sits beneath the defenders while a shot is the choice under the cursor,
    including through the technique step, since having chosen to shoot the keeper is still
    exactly who the question is about. It is the keeper of the goal being attacked, and the
    effective figure rather than the printed one, like everything else in that panel: a withered
    keeper really does catch at reduced strength, and that is the number the engine will roll.
    Deliberately not permanent. The keeper decides nothing about a pass or a breakthrough, and
    the panel is meant to be the numbers for *this* choice rather than a stat sheet.
    `previewsShot()` is the menu's answer, alongside `previewTargetId()` — which row a cursor
    sits on is a question the UI asks, never something written into match state.
    UI only; no ladder.
20. **Sound** ✅ (#56). Shoot, pass, tackle, goal, save, breakthrough, the encounter opening,
    and the whistle. **Synthesised rather than sampled** — oscillators and filtered noise built
    at the moment each plays — so the repository stays free of binary assets and licences, and
    every sound sits where all the other tunables do: in code, as named numbers with a note on
    why. All of it runs through one low-pass, because all of it happens underwater; that single
    filter is what stops a set of dry synth blips sounding like a menu.
    Split in two, along the line that decides what is worth testing. `audio/events.ts` derives
    *what happened* from two frames of the phase machine and is pure and tested — sixteen tests,
    including a full match asserting no frame ever reports both a goal and a save, or both a
    tackle and a breakthrough. `audio/sounds.ts` decides what a tackle sounds like, which is
    taste and is not tested.
    The engine is never told anyone is listening: the sounds are read from outside exactly as
    the renderer reads positions. `CLAUDE.md` now says so as a rule, since an event fired *for*
    the presentation is the tempting thing to add and the thing to avoid.
    `m` mutes. Nothing plays before the first keypress, which browsers require anyway.
    The whistle is the one exception to the water, and had to be: sitting at 1900–2100Hz against
    a 2200Hz cutoff it was inaudible, because right on the knee a square wave loses every
    harmonic that makes it shrill and what survives is a quiet sine. It now takes a dry bus, at
    a lower pitch with a breath of noise over it — which is also the truer story, since a
    whistle is blown *above* the water by someone who means to be heard through it. It blows at
    kick-off and at the restart too, not only at the two ends: a half is five minutes, and a
    sound nobody hears for five minutes is indistinguishable from one that does not work.

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
real engine, and `core/league/ladder.ts` runs it over all thirty pairings at both ends — the
instrument used whenever a formula constant moves. `npm run ladder` prints the table; it is
skipped by `npm test`, being an instrument rather than an assertion.

It lives in the repository rather than being rebuilt from memory each time, which is how it was
used for its first dozen readings. A measurement is only worth something if the next one is
taken the same way, and three of these were rebuilt by hand before that became obvious.

Before #24 that ladder read:

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

Swept properly in #46, and worth recording so the next tune starts from knowledge rather than
from the same three runs. `SHOOTING_STANDOFF` at 0.18, 0.22 and 0.26 of the pool gives 5.76,
1.96 and 0.98 goals a match: it cannot be aimed with. `SHOT_DECAY_PER_UNIT` is close to linear
over 0.42–0.50, about 0.2 goals a match per hundredth, and leaves the table order alone — it is
the lever to reach for. The blocker coverage weights saturate: everything from 0.35 down to 0.2
lands at 2.25, and all of it comes out of the weaker sides' points.

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
