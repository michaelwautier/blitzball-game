# Blitzball — Browser Proof of Concept

A faithful recreation of Final Fantasy X's Blitzball minigame, playable in the browser.
Fan project for personal use, using authentic FFX teams, players, and (approximated) stats.

## Decisions locked in

- **Fidelity:** Faithful hybrid — real-time swimming with the ball, pause-and-menu encounters
  when defenders engage, stat-vs-stat resolution with randomization like the original.
- **View:** 2D top-down of the sphere pool. Canvas rendering with simple shapes/sprites.
- **Stack:** Vite + TypeScript + hand-rolled Canvas renderer and game loop. No framework.
- **Rosters:** Authentic FFX teams (Besaid Aurochs, Luca Goers, Al Bhed Psyches, Ronso Fangs,
  Guado Glories, Kilika Beasts) with stats approximating the original data.
- **Scope:** Full loop — single match first, then techniques, leveling, and league/recruiting.

## Game rules being recreated (reference)

- 6 players per side: LF, RF, MF, LD, RD, GK. Two halves on a countdown clock
  (FFX uses 5:00 halves; PoC default 3:00, configurable).
- Player stats: **HP, SP** (swim speed), **EN** (endurance/dribble), **AT** (attack/tackle),
  **PA** (pass), **BL** (block), **SH** (shoot), **CA** (catch, mainly keepers).
- Free play: the ball carrier is user-controlled; teammates and opponents are AI-positioned.
  Defenders converge on the carrier.
- **Encounter:** when defenders reach the carrier, the game pauses and shows the menu —
  Breakthrough (dribble past), Pass, or Shoot. Defenders each spend their AT against the
  chosen action:
  - *Breakthrough:* carrier EN vs sum of defender AT rolls. EN survives → swim past; EN hits 0 → ball stolen.
  - *Pass:* PA reduced by each defender's AT roll, then decays with pass distance. PA reaches 0 mid-flight → interception/loose ball. Receiver needs the remaining value ≥ 1 (CA catch roll for contested balls).
  - *Shoot:* SH reduced by defender AT rolls and distance decay; remaining SH vs keeper's CA roll. SH > CA → goal; else caught (or deflected if close).
  - Each stat roll is randomized upward from its base (FFX rolls between the stat value and ~1.5×) so underdogs can win exchanges.
- **Techniques:** actions cost HP; techs (Venom Pass, Nap Shot, Sphere Shot, Jecht Shot…)
  cost more HP for bonuses/status effects (poison, sleep, dark drain the target's stats or
  disable them briefly). HP regenerates slowly when swimming without the ball; a player at
  0 HP acts at minimum effectiveness until recovered.
- **EXP/Leveling:** every contested action grants EXP; levels raise stats along per-player
  growth curves (Tidus grows into a shooter, Wakka is strong early, etc.).
- **League:** round-robin among the 6 teams, 3 points per win, standings table. Between
  matches you can scout and sign free agents (contract = salary per game + game count).

## Architecture

```
src/
  core/            # deterministic simulation — no DOM, no Canvas
    match/         #   match state machine, clock, kickoff/goal/halftime flow
    encounter/     #   encounter trigger + resolution math (rolls, decay, steal/goal logic)
    ai/            #   positioning, defender convergence, AI team decision-making
    league/        #   fixtures, standings, contracts, free agents
    progression/   #   EXP awards, level curves, stat growth
    rng.ts         #   seedable RNG so matches are replayable/testable
  data/            # teams.ts, players.ts, techs.ts — authentic rosters as plain data
  render/          # Canvas renderer: pool, players, ball, trajectories, HUD
  ui/              # DOM overlays: encounter menu, tech picker, scoreboard, league screens
  input/           # keyboard/mouse mapping
  main.ts          # fixed-timestep loop wiring core → render/ui
```

Key principle: **the sim core is pure and deterministic** (seeded RNG, fixed timestep).
Rendering and DOM menus read state and emit intents. This makes encounter math unit-testable
and lets the AI-vs-AI league simulator reuse the exact same match engine headlessly.

Match state machine: `Kickoff → FreePlay ⇄ Encounter → (Resolution anim) → FreePlay | Goal → Kickoff → Halftime → … → FullTime`.

## Phases

### Phase 0 — Scaffold ✅ (PR #1)
Vite + TS project, fixed-timestep game loop with interpolated rendering, Canvas pool
rendering (circular pool, halfway line, two goals), debug overlay, seedable RNG, and CI
running typecheck/tests/build on every PR.

### Phase 1 — Playable single match (the real PoC milestone)
- Data: Aurochs + Goers rosters with stats.
- Free play: WASD/arrow control of ball carrier; auto-switch to nearest player on defense
  (or spectate — defense is largely automatic in FFX too); formation-based AI positioning;
  defender convergence; keeper positioning.
- Encounter system: proximity trigger, pause, menu (Breakthrough / Pass / Shoot / target
  picker), full resolution math with visible rolls ("EN 15 vs AT 9 + AT 7 → break!").
- Ball flight for passes/shots with mid-flight interception checks; goals, score, clock,
  halves, kickoffs; end-of-match screen.
- AI opponent makes the same encounter decisions via simple heuristics (shoot when close
  and SH high, pass to open man, breakthrough when EN dominates).
- **Exit criteria: you can beat the Luca Goers in a fair, complete match in the browser.**

### Phase 2 — Techniques & HP
HP costs on all actions + slow regen; ~8 iconic techs (Jecht Shot, Venom Pass/Shot/Tackle,
Nap Shot, Sphere Shot, Wither Pass, Brawler) with status effects (poison/sleep/dark) shown
in the encounter menu with HP costs; tech slots per player; status icons over player heads.

### Phase 3 — EXP & leveling
EXP per contested action, level-up between matches with growth curves per player,
post-match summary screen showing EXP gains and stat changes.

### Phase 4 — League & recruiting
Fixture list for all 6 teams; other fixtures auto-simmed headlessly with the same engine;
standings table; free-agent pool (Brother, Ropp, Jumal, Wedge…) with salaries/contracts;
simple prize money economy; save/load via `localStorage`.

## Risks & notes

- **Exact FFX formulas** aren't officially published; community documentation (roll ranges,
  distance decay) is good but approximate. The sim isolates all formulas in
  `core/encounter/` so tuning is one file, with unit tests locking in expected behavior.
- **Top-down readability:** FFX plays in 3D; the top-down abstraction flattens depth.
  Acceptable for PoC — the encounter menus carry most of the real gameplay.
- **AI tuning** is the likeliest time sink in Phase 1; heuristics first, polish later.
- Rosters/stats are transcribed approximations of FFX data — fine for a personal fan
  project; swap to an original cast before any public release.
