import { POOL_RADIUS, clampToPool, type Vec2 } from '../pitch'
import { attackDirection } from '../match/formation'
import { PLAYER_RADIUS, REFERENCE_POOL_RADIUS } from '../match/movement'
import { distanceBetween, opponentOf, playerById } from '../match/queries'
import { giveBallTo } from '../match/possession'
import { startPass, startShot } from '../match/flight'
import type {
  ChallengeRun,
  DefenceChoice,
  Encounter,
  EncounterAction,
  EncounterDefender,
  EncounterKind,
  EncounterResult,
  MatchState,
  Player,
} from '../match/types'
import { USER_TEAM } from '../match/types'
import { ACTION_HP_COST, passRange, rollBounds, rollStat } from './formulas'
import { findTechnique, techniquesOf, type Technique } from '../../data/techniques'
import { applyStatus } from '../match/status'
import { canAfford, effectiveStat, spendHp } from '../match/stats'
import { awardExp } from '../match/exp'
import { announce as announceChallenge } from '../match/announce'

/**
 * How close a defender must be to drag the carrier into an encounter.
 *
 * Must exceed the separation floor of `PLAYER_RADIUS * 2`, or bodies could never
 * get close enough to trigger one, and must stay above `MARKING_DISTANCE` so a
 * defender at its marking station is genuinely on the carrier.
 *
 * Scales with the pool, in proportion. Bodies deliberately do not — that is what
 * turns a bigger pool into more space rather than the same game drawn larger —
 * but reach is not a body, and leaving it fixed meant defenders covered so much
 * less of the water that attackers ran clear and scoring reached 24 a match.
 *
 * The square root was tried first, as the halfway house between the two, and
 * replaced by full proportion in #15 once the pool had more than doubled: at
 * that size the square root was still leaving two defenders unable to close
 * anyone down. Read that alongside `MAX_ENGAGED` and the coverage weights, which
 * were set against this reach and would need re-measuring if it moved.
 */
export const ENGAGE_RADIUS =
  PLAYER_RADIUS * 2.3 * (POOL_RADIUS / REFERENCE_POOL_RADIUS)

/**
 * Seconds the defenders take to settle in front of the carrier.
 *
 * An encounter in FFX is a tableau: the defenders come round in front of the
 * player on the ball and face them, and the camera reads the confrontation.
 * Ours simply froze wherever everyone happened to be, which meant a decision
 * about two specific defenders was often taken while they were beside or behind
 * the carrier, and nothing on screen said who the menu was talking about.
 *
 * Short — they are already within `ENGAGE_RADIUS`, so this is a small adjustment
 * rather than a swim.
 */
export const STAGING_SECONDS = 0.26

/** Seconds an AI carrier appears to deliberate, so its choice is readable. */
export const AI_THINK_SECONDS = 0.35

/** Seconds the outcome is shown before play resumes. */
export const RESULT_SECONDS = 1.1

/**
 * Seconds before *anyone* may engage again after a successful breakthrough.
 *
 * Deliberately brief now that beaten defenders are individually put out of the
 * play: this only stops an encounter reopening on the very next tick. A long
 * global hold was a blunt instrument, freezing defenders who had nothing to do
 * with the challenge.
 */
export const BREAKTHROUGH_GRACE = 2

/**
 * Seconds a beaten defender spends out of the play.
 *
 * Long enough that getting past someone means actually being past them. Without
 * it they turned round and re-engaged almost immediately, so a breakthrough
 * bought a moment rather than an advantage.
 */
export const BREAKTHROUGH_RECOVERY = 1.6

/**
 * Seconds before *this defender* may challenge again.
 *
 * They committed to a carrier and the moment passed. They are not beaten — they
 * keep swimming, marking and blocking — but a defender cannot throw themselves
 * at two decisions in the same breath.
 *
 * Deliberately shorter than `RESUME_GRACE`, which means it never binds on the
 * engine: by the time the global pacing allows another encounter, this has long
 * expired. It exists for the one case that *does* bypass the global grace — a
 * person pressing the challenge key — so that repeatedly mashing it cannot turn
 * one defender into a machine for manufacturing encounters.
 *
 * A longer cooldown here was tried, on the theory that per-defender pacing could
 * replace the global blackout entirely. It cannot: five outfielders a side is a
 * deep enough bench that encounters saturated at 177–246 a match even at eleven
 * seconds each, and the sides with weak defences were punished hardest — Besaid
 * went from 124:329 to 52:379. The global grace paces the game; this only stops
 * an individual being spammed.
 */
export const ENGAGED_COOLDOWN = 2

/**
 * Seconds before the engine opens another encounter of its own accord.
 *
 * This is the pacing dial #24 tuned, and it is back near where it left it. What
 * has changed is that it no longer traps anybody: a defender who wants to
 * challenge during it can, through `requestChallenge`, exactly as a carrier has
 * always been able to stop and look up. It governs what the game does by itself,
 * not what a person is allowed to do.
 */
export const RESUME_GRACE = 4

/**
 * How many opponents can be on the carrier at once.
 *
 * Two. A third body in the water is covering the pass, not the ball, however
 * close it happens to be — and the distinction decides whether the game has any
 * attacking play in it at all.
 *
 * Blocking and tackling are both summed across everyone engaged, so each extra
 * defender adds a whole roll to every route out. At level one a carrier brings
 * SH 9–13 and EN 2–20 against defenders who block at 8–14 and tackle at 8–12.
 * Two of those is a hard contest. Three is arithmetic: the throw cannot survive
 * the blocking, the breakthrough cannot survive the tackling, and the only sides
 * conceding goals were the two whose defenders block at 5 and 2. Four fifths of
 * every shot in the game was blocked before it left, and four of the six squads
 * went a full season without letting one in.
 *
 * Capping here rather than by keeping the third defender further away, which was
 * tried first and does nothing: a defender heading for a covering position is
 * still swimming past the carrier to reach it.
 */
export const MAX_ENGAGED = 2

/** Opponents currently close enough to engage this carrier, closest first. */
export function engagingDefenders(state: MatchState, carrier: Player): Player[] {
  return state.players
    .filter(
      (p) =>
        p.team === opponentOf(carrier.team) &&
        p.slot !== 'GK' &&
        // Still recovering from being beaten, so in no position to challenge.
        p.recovery <= 0 &&
        // Or committed a moment ago: chasing again, but not yet challenging.
        p.engageCooldown <= 0 &&
        distanceBetween(p, carrier) <= ENGAGE_RADIUS,
    )
    .sort((a, b) => distanceBetween(a, carrier) - distanceBetween(b, carrier))
    .slice(0, MAX_ENGAGED)
}

/**
 * Open an encounter against these defenders.
 *
 * Their attack stats are recorded as they stand; the tackles themselves are
 * rolled when they are made. The menu therefore shows a range rather than a
 * promise, which is the honest presentation of a gamble.
 */
export function openEncounter(
  state: MatchState,
  carrier: Player,
  defenders: Player[],
): Encounter {
  stageDefenders(state, carrier, defenders)

  return {
    carrierId: carrier.id,
    defenders: defenders.map((d) => ({
      id: d.id,
      attack: effectiveStat(d, 'at'),
      block: effectiveStat(d, 'bl'),
    })),
    kind: 'contested',
    endurance: state.endurance,
    thinkTimer: carrier.team === USER_TEAM ? 0 : AI_THINK_SECONDS,
    // Being run at is a decision too: the carrier waits on the defence.
    awaitingDefence: defenders.some((d) => d.team === USER_TEAM),
    defence: null,
  }
}

/**
 * Bring the defenders round in front of the carrier.
 *
 * They line up between the carrier and the goal being attacked, fanned to one
 * side of each other so two defenders are two readable bodies rather than one
 * overlapping blob. Committed as a lunge rather than assigned, so it is a
 * movement you watch happen and `prevX/prevY` stay honest — the interpolation
 * bugs of #10 all came from moving bodies without telling the renderer.
 *
 * These positions outlive the encounter: a defender staged goal-side is
 * genuinely better placed when play resumes, which is why this is measured
 * rather than assumed to be cosmetic.
 */
function stageDefenders(state: MatchState, carrier: Player, defenders: Player[]): void {
  const forward = attackDirection(state.teams[carrier.team].defending)
  // Fan away from the nearer wall, so nobody is staged outside the pool.
  const away = carrier.y >= 0 ? -1 : 1

  const spotAt = (rank: number): Vec2 =>
    clampToPool(
      {
        x: carrier.x + forward * ENGAGE_RADIUS * 0.8,
        y: carrier.y + away * rank * PLAYER_RADIUS * 2.4,
      },
      PLAYER_RADIUS,
    )

  // Anyone not in this confrontation is furniture to be staged around. The spot
  // is worked out from the carrier alone, so without this a defender settles
  // into whoever happens to be standing in front of them — and stays there,
  // because bodies are not separated while the world is frozen for the menu.
  // The overlap then lasts the whole decision rather than a moment.
  const bystanders = state.players.filter(
    (player) => player !== carrier && !defenders.includes(player),
  )

  let rank = 0
  for (const defender of defenders) {
    let spot = spotAt(rank)
    // Step along the fan until the slot is free, rather than abandoning the
    // tableau: the defenders still arrive in a line in front of the carrier,
    // just further out along it.
    for (let tried = 0; tried < STAGING_SLOTS && occupied(spot, bystanders); tried++) {
      rank++
      spot = spotAt(rank)
    }
    rank++

    defender.lunge = {
      fromX: defender.x,
      fromY: defender.y,
      toX: spot.x,
      toY: spot.y,
      duration: STAGING_SECONDS,
      elapsed: 0,
    }
    defender.vx = 0
    defender.vy = 0
  }
}

/**
 * How far along the fan the staging will look for a clear slot.
 *
 * Bounded so a crowded pool cannot walk a defender off into open water hunting
 * for room. Running out means staging on someone, which is what happened every
 * time before.
 */
const STAGING_SLOTS = 6

/** Whether a staged spot would land inside a body already standing there. */
function occupied(spot: Vec2, bystanders: readonly Player[]): boolean {
  return bystanders.some(
    (player) => Math.hypot(player.x - spot.x, player.y - spot.y) < PLAYER_RADIUS * 2,
  )
}

/**
 * The carrier stops and looks up of their own accord.
 *
 * No defender has committed, so there is nothing to break past: the choice is
 * simply who to find, or whether to take it on themselves.
 */
export function openOnTheBall(state: MatchState, carrier: Player): Encounter {
  return {
    kind: 'onTheBall',
    carrierId: carrier.id,
    defenders: [],
    endurance: state.endurance,
    thinkTimer: carrier.team === USER_TEAM ? 0 : AI_THINK_SECONDS,
    awaitingDefence: false,
    defence: null,
  }
}

/**
 * The least and most total tackle a carrier could face from these defenders.
 *
 * Mirrors the bounds of `rollStat`, and is the single source of truth for both
 * the menu's odds and the AI's judgement — so what a player is shown and what
 * the opponent reasons about cannot drift apart.
 */
export function tackleRange(defenders: readonly EncounterDefender[]): {
  min: number
  max: number
} {
  return totalRange(defenders.map((d) => d.attack))
}

/**
 * The same, for the blocking a pass or shot has to survive.
 *
 * Weighted exactly as `contestThrow` weights it, so the odds the menu shows and
 * the odds the AI reasons about are the odds that actually get rolled.
 */
export function blockRange(defenders: readonly EncounterDefender[]): {
  min: number
  max: number
} {
  return totalRange(defenders.map((d) => d.block), coverageOf)
}

/**
 * How far this carrier's pass can actually reach, past whoever is on them.
 *
 * Three numbers because the blocking is rolled: `min` is the distance a pass is
 * certain to cover even if every defender reads it, `max` the distance it can
 * cover if none of them lay a hand on it, and `expected` the middle — which is
 * what the AI judges on, matching how `isShotWorthTaking` treats a shot.
 *
 * The menu shows the first two, so choosing a receiver is choosing between
 * passes that can arrive rather than guessing at a range the game never
 * mentioned. Out beyond `max` a pass is not a risk, it is a giveaway: it flies
 * the whole way, arrives with nothing on it, and is fumbled to the opposition.
 */
export function passReach(
  carrier: Player,
  defenders: readonly EncounterDefender[],
): { min: number; max: number; expected: number } {
  const power = effectiveStat(carrier, 'pa')
  const blocks = blockRange(defenders)
  return {
    min: passRange(power - blocks.max),
    max: passRange(power - blocks.min),
    expected: passRange(power - (blocks.min + blocks.max) / 2),
  }
}

function totalRange(
  stats: readonly number[],
  weightOf: (index: number) => number = () => 1,
): { min: number; max: number } {
  let min = 0
  let max = 0
  stats.forEach((stat, index) => {
    const bounds = rollBounds(stat)
    const weight = weightOf(index)
    min += Math.round(bounds.min * weight)
    max += Math.round(bounds.max * weight)
  })
  return { min, max }
}

/** Which actions this kind of decision permits. */
export function allowedActions(kind: EncounterKind): EncounterAction['kind'][] {
  switch (kind) {
    case 'contested':
      return ['breakthrough', 'pass', 'shoot']
    case 'onTheBall':
      return ['pass', 'shoot']
    case 'distribution':
      return ['pass']
  }
}

/**
 * A keeper restarting play after claiming the ball.
 *
 * Keepers hold their line: they never dribble out or shoot, so the only decision
 * is who to find. Modelled as an encounter with no defenders so it reuses the
 * same menu, resolution and technique handling as any other pass.
 */
export function openDistribution(state: MatchState, keeper: Player): Encounter {
  return {
    kind: 'distribution',
    carrierId: keeper.id,
    defenders: [],
    endurance: state.endurance,
    thinkTimer: keeper.team === USER_TEAM ? 0 : AI_THINK_SECONDS,
    awaitingDefence: false,
    defence: null,
  }
}

/**
 * Resolve the carrier's chosen action, mutating the match accordingly.
 *
 * Breakthrough settles here and play resumes. Pass and shoot hand off to a ball
 * flight, which can still be intercepted before it arrives — so choosing them is
 * a commitment, not a guaranteed escape.
 */
export function resolveEncounter(
  state: MatchState,
  encounter: Encounter,
  action: EncounterAction,
): EncounterResult {
  const carrier = playerById(state, encounter.carrierId)
  if (!carrier) {
    return { action: action.kind, success: false, summary: 'Possession lost' }
  }

  // Anything the decision does not permit is refused outright rather than
  // half-applied, so no stray input can dribble a goalkeeper up the pool or
  // barge past defenders who were never there.
  if (!allowedActions(encounter.kind).includes(action.kind)) {
    return {
      action: action.kind,
      success: false,
      summary:
        encounter.kind === 'distribution'
          ? `${carrier.def.name} must find a teammate`
          : `${carrier.def.name} cannot do that here`,
    }
  }

  switch (action.kind) {
    case 'breakthrough':
      return resolveBreakthrough(state, encounter, carrier, action)
    case 'pass':
      return resolvePass(state, encounter, carrier, action)
    case 'shoot':
      return resolveShoot(state, encounter, carrier, action)
  }
}

/**
 * Each defender in turn puts in a tackle, and endurance has to survive them all.
 *
 * Tackles are resolved one at a time rather than as a single pooled total, so
 * the carrier is up against a sequence of individual challenges: the first
 * defender may take most of the endurance and leave the second an easy job, or
 * may barely make contact. Whoever takes it to zero is the one who comes away
 * with the ball, which is why the closest defender tackles first.
 *
 * The drain persists for the whole possession, so repeated breakthroughs get
 * progressively more dangerous — that pressure is what makes passing and
 * shooting real decisions rather than fallbacks.
 */
/** "EN 14 − 6 − 5 = 3", the arithmetic laid out as it happened. */
function describeChallenge(from: number, rolls: number[], to: number): string {
  return rolls.length > 0 ? `EN ${from} − ${rolls.join(' − ')} = ${to}` : ''
}

/**
 * Seconds the carrier who just lost the ball spends out of the play.
 *
 * They were beaten; being beaten should cost the same whichever end of the
 * challenge you were on. Without it the dispossessed player kept full agency and
 * could challenge back on the very next frame — which is exactly what happened,
 * because the space bar that confirmed the breakthrough is also the one that
 * challenges. The ball changed hands and a "how do you challenge?" menu opened
 * instantly on top of it, with nothing to say what had gone wrong.
 *
 * Shorter than `BREAKTHROUGH_RECOVERY`: losing the ball already costs the ball.
 */
export const DISPOSSESSED_RECOVERY = 1.2

/** Hand the ball to whoever won it, with whatever technique they had ready. */
function concedePossession(
  state: MatchState,
  tackler: Player,
  carrier: Player,
  defence: DefenceChoice | null = null,
): string {
  awardExp(state, tackler, 'tackle')
  const technique = useTackleTechnique(tackler, carrier, defence)
  giveBallTo(state, tackler)
  // Beaten, and out of the play for it — see the constant. Applied after
  // `giveBallTo`, which is what would otherwise leave them free to turn straight
  // round and challenge the player who has just taken it.
  carrier.recovery = Math.max(carrier.recovery, DISPOSSESSED_RECOVERY)
  return `tackled by ${tackler.def.name}${technique ? ` · ${technique.name}!` : ''}`
}

/**
 * Take on the nearest `breakPast` defenders.
 *
 * Beating all of them is a breakthrough in the old sense: the carrier is free
 * and play resumes. Beating some leaves them still caught, by whoever was not
 * challenged — and the encounter stays open so they can decide again against the
 * shorter list. There is deliberately no outcome here that returns a carrier to
 * open water while a defender is still on them.
 */
function resolveBreakthrough(
  state: MatchState,
  encounter: Encounter,
  carrier: Player,
  action: Extract<EncounterAction, { kind: 'breakthrough' }>,
): EncounterResult {
  const count = Math.max(1, Math.min(action.breakPast, encounter.defenders.length))
  spendHp(carrier, ACTION_HP_COST.breakthrough)

  // Handed to the challenge phase rather than settled here. Each defender is
  // taken in turn, a beat apart, so the endurance can be watched going.
  state.phase = {
    kind: 'challenge',
    challenge: {
      carrierId: carrier.id,
      queue: encounter.defenders.slice(0, count),
      survivors: encounter.defenders.slice(count),
      endurance: encounter.endurance,
      from: encounter.endurance,
      rolls: [],
      beaten: [],
      timer: 0,
      defence: encounter.defence,
    },
  }

  return {
    action: 'breakthrough',
    success: true,
    summary: `${carrier.def.name} takes on ${namesOf(state, encounter.defenders.slice(0, count))}`,
  }
}

/** "Larbeight" or "Larbeight & Kulukan", as FFX names them rather than counting. */
function namesOf(state: MatchState, defenders: readonly EncounterDefender[]): string {
  const names = defenders.map((d) => playerById(state, d.id)?.def.name ?? '?')
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`
}

/**
 * Seconds between one tackle landing and the next going in.
 *
 * Long enough to read the endurance change, short enough that barging through
 * two defenders is still one movement rather than a cutscene.
 */
export const TACKLE_BEAT = 0.55

/** Seconds the last tackle is left on screen before play resumes. */
export const CHALLENGE_SETTLE = 0.75

/**
 * Advance a breakthrough that is playing out.
 *
 * One tackle per beat, in the order the menu named them. The endurance carried
 * on the run is the live one — `state.endurance` follows it down — so whatever is
 * drawing the number watches it fall rather than jumping to the final figure.
 */
export function stepChallenge(state: MatchState, dt: number, run: ChallengeRun): void {
  run.timer -= dt
  if (run.timer > 0) return

  const carrier = playerById(state, run.carrierId)
  if (!carrier || state.ball.carrier !== carrier.id) {
    state.phase = { kind: 'play' }
    return
  }

  const next = run.queue.shift()

  // Everyone in the way has had their go and the carrier is still holding it.
  if (!next) return finishChallenge(state, run, carrier)

  const defender = playerById(state, next.id)
  if (!defender) return stepChallenge(state, 0, run)

  const tackle = rollStat(effectiveStat(defender, 'at'), state.rng)
  run.rolls.push(tackle)
  run.beaten.push(next)
  run.endurance -= tackle
  state.endurance = Math.max(0, run.endurance)

  const sums = describeChallenge(run.from, run.rolls, run.endurance)

  if (run.endurance <= 0) {
    // This one took it. Nobody behind them needs to bother.
    // Everyone who was in this is done challenging, whether they got their
    // tackle in or the ball was gone before they could — exactly as it was when
    // the whole thing settled in one tick.
    chargeCommittedDefenders(state, {
      ...emptyEncounter(carrier),
      defenders: [...run.beaten, ...run.queue, ...run.survivors],
    })
    run.queue.length = 0
    pushPastCarrier(state, [defender], carrier, defender)
    announceChallenge(state, `${sums} · ${concedePossession(state, defender, carrier, run.defence)}`)
    state.phase = { kind: 'play' }
    return
  }

  pushPastCarrier(state, [defender], carrier)
  announceChallenge(state, `${sums} · past ${defender.def.name}`)
  run.timer = run.queue.length > 0 ? TACKLE_BEAT : CHALLENGE_SETTLE
}

/** A bare encounter shell, only ever used to hand `chargeCommittedDefenders` a list. */
function emptyEncounter(carrier: Player): Encounter {
  return {
    kind: 'contested',
    carrierId: carrier.id,
    defenders: [],
    endurance: 0,
    thinkTimer: 0,
    awaitingDefence: false,
    defence: null,
  }
}

/** The carrier survived everyone they took on. */
function finishChallenge(state: MatchState, run: ChallengeRun, carrier: Player): void {
  awardExp(state, carrier, 'breakthrough')
  const sums = describeChallenge(run.from, run.rolls, run.endurance)

  if (run.survivors.length === 0) {
    state.engageCooldown = BREAKTHROUGH_GRACE
    announceChallenge(state, `${sums} · ${carrier.def.name} breaks through!`)
    state.phase = { kind: 'play' }
    return
  }

  // Past the ones they took on, still held by the rest. Back to the decision,
  // against whoever is left and with the endurance this run cost them.
  announceChallenge(state, `${sums} · past ${namesOf(state, run.beaten)}, still held`)
  state.phase = {
    kind: 'encounter',
    encounter: {
      kind: 'contested',
      carrierId: carrier.id,
      defenders: run.survivors,
      endurance: state.endurance,
      thinkTimer: carrier.team === USER_TEAM ? 0 : AI_THINK_SECONDS,
      awaitingDefence: false,
      defence: run.defence,
    },
  }
}

/**
 * Put the defenders who were on the carrier out of the challenging business.
 *
 * They committed, and the moment has passed — whether the carrier threw, barged
 * past them, or lost it. They carry on swimming, since this is not being beaten,
 * but the next carrier is somebody else's to pick up.
 *
 * Charged wherever an encounter *ends*, so no outcome is a free re-engagement.
 */
export function chargeCommittedDefenders(state: MatchState, encounter: Encounter): void {
  for (const engaged of encounter.defenders) {
    const defender = playerById(state, engaged.id)
    if (defender) defender.engageCooldown = ENGAGED_COOLDOWN
  }
}


/**
 * Seconds a beaten defender takes to be carried past the carrier.
 *
 * Short: a challenge is a lunge, not a swim. It runs inside the recovery period,
 * so they arrive behind the play and then spend the rest of it turning round.
 */
export const LUNGE_SECONDS = 0.32

/**
 * Send the defenders who tackled past the carrier.
 *
 * A challenge carries a defender past the player they went through, so leaving
 * them in front would mean a successful breakthrough changed nothing
 * positionally and the same defenders re-engaged the moment the grace period
 * ended. The momentum applies to all of them, winner included — that is what a
 * tackle looks like.
 *
 * `recovery` does not. It means *beaten*, and a beaten player neither swims nor
 * challenges until it runs down. Whoever came away with the ball was not beaten,
 * and charging them for winning left them frozen in the water holding it, unable
 * to swim, for a second and a half.
 */
function pushPastCarrier(
  state: MatchState,
  defenders: Player[],
  carrier: Player,
  winner?: Player,
): void {
  const forward = attackDirection(state.teams[carrier.team].defending)

  for (const defender of defenders) {
    const spot = clampToPool(
      { x: carrier.x - forward * (ENGAGE_RADIUS + 1), y: defender.y },
      PLAYER_RADIUS,
    )
    // Committed as a movement rather than applied as a jump, so it is something
    // you watch happen: they carry through the carrier and pull up behind.
    defender.lunge = {
      fromX: defender.x,
      fromY: defender.y,
      toX: spot.x,
      toY: spot.y,
      duration: LUNGE_SECONDS,
      elapsed: 0,
    }
    defender.vx = 0
    defender.vy = 0
    if (defender !== winner) defender.recovery = BREAKTHROUGH_RECOVERY
  }
}

/**
 * Fire a tackle technique on the player who was just dispossessed.
 *
 * `chosen` is what the defence committed to, if a person was asked. Honoured
 * only if the defender who actually won the ball knows it and can pay — the
 * choice is made before the rolls, so it may land on someone else entirely, and
 * a plain tackle is the honest outcome rather than quietly substituting another
 * technique nobody picked.
 *
 * With nothing chosen, as when the AI defends, the first affordable technique
 * fires automatically.
 */
export function useTackleTechnique(
  tackler: Player,
  victim: Player,
  defence: DefenceChoice | null = null,
): Technique | null {
  const known = techniquesOf(tackler.def.techniques, 'tackle')
  // Nobody chose: the defender brings whatever they have. Somebody chose: only
  // that, and choosing nothing means nothing.
  const candidates = defence
    ? known.filter((t) => t.id === defence.techniqueId)
    : known

  for (const technique of candidates) {
    if (!canAfford(tackler, technique.hpCost)) continue
    spendHp(tackler, technique.hpCost)
    if (technique.inflicts) applyStatus(victim, technique.inflicts)
    return technique
  }
  return null
}

/** Tackle techniques the user's engaged defenders could bring to bear. */
export function defensiveTechniques(state: MatchState, encounter: Encounter): Technique[] {
  const seen = new Set<string>()
  const available: Technique[] = []

  for (const engaged of encounter.defenders) {
    const defender = playerById(state, engaged.id)
    if (!defender || defender.team !== USER_TEAM) continue

    for (const technique of techniquesOf(defender.def.techniques, 'tackle')) {
      if (seen.has(technique.id) || !canAfford(defender, technique.hpCost)) continue
      seen.add(technique.id)
      available.push(technique)
    }
  }

  return available
}

/**
 * The defenders left of a pass or shot: their blocking, rolled, comes off it.
 *
 * Resolved defender by defender in order of proximity so, as with a tackle,
 * whoever takes it to zero is the one who ends up with the ball. This is why
 * stopping on the ball in space is worth so much — with nobody engaged there is
 * nothing to subtract, and the throw faces only the distance.
 */
/**
 * How much of their blocking each defender actually brings, by closeness.
 *
 * The nearest defender is in the throwing lane and blocks with everything they
 * have. The next is behind their shoulder, covering ground the first already
 * covers, and contributes half.
 *
 * Tackling still sums in full — two players can both get hands on a carrier —
 * but two bodies do not block twice as much of an open ring, and treating them
 * as though they did is what made throwing impossible at level one. A shooter
 * carries SH 9 to 13; the Guado block at 14, 10, 7, 7 and 6, so any two of them
 * summed outright exceeded every shot in the game before it was thrown. They
 * went whole seasons without conceding or scoring.
 */
const NEAREST_BLOCKER_COVERAGE = 1
const SECOND_BLOCKER_COVERAGE = 0.5

function coverageOf(index: number): number {
  return index === 0 ? NEAREST_BLOCKER_COVERAGE : SECOND_BLOCKER_COVERAGE
}

function contestThrow(
  state: MatchState,
  defenders: readonly EncounterDefender[],
  power: number,
): { power: number; rolls: number[]; taker: Player | undefined } {
  const rolls: number[] = []
  let remaining = power

  let index = 0
  for (const engaged of defenders) {
    const defender = playerById(state, engaged.id)
    if (!defender) continue

    const block = Math.round(
      rollStat(effectiveStat(defender, 'bl'), state.rng) * coverageOf(index++),
    )
    remaining -= block
    rolls.push(block)

    if (remaining <= 0) return { power: remaining, rolls, taker: defender }
  }

  return { power: remaining, rolls, taker: undefined }
}

/** "PA 8 − 3 − 2 = 3", the arithmetic laid out as it happened. */
function describeThrow(label: string, from: number, rolls: number[], to: number): string {
  const steps = rolls.length > 0 ? ` − ${rolls.join(' − ')}` : ''
  return `${label} ${from}${steps} = ${Math.max(0, Math.round(to))}`
}

function resolvePass(
  state: MatchState,
  encounter: Encounter,
  carrier: Player,
  action: Extract<EncounterAction, { kind: 'pass' }>,
): EncounterResult {
  const receiver = playerById(state, action.targetId)
  if (!receiver || receiver.team !== carrier.team) {
    return { action: 'pass', success: false, summary: 'No one to pass to' }
  }

  const technique = affordableTechnique(carrier, action.techniqueId, 'pass')
  spendHp(carrier, ACTION_HP_COST.pass + (technique?.hpCost ?? 0))

  const start = effectiveStat(carrier, 'pa') + (technique?.power ?? 0)
  const contest = contestThrow(state, encounter.defenders, start)
  const name = technique ? `${technique.name} · ` : ''
  const sums = describeThrow('PA', start, contest.rolls, contest.power)

  // A pass technique's condition lands on everyone who tried to cut it out.
  if (technique?.inflicts) {
    for (const engaged of encounter.defenders) {
      const defender = playerById(state, engaged.id)
      if (defender) applyStatus(defender, technique.inflicts)
    }
  }

  if (contest.taker) {
    awardExp(state, contest.taker, 'interception')
    giveBallTo(state, contest.taker)
    return {
      action: 'pass',
      success: false,
      summary: `${name}${sums} · ${contest.taker.def.name} intercepts!`,
    }
  }

  state.ball.carrier = null
  state.phase = { kind: 'flight', flight: startPass(carrier, receiver, contest.power, technique) }
  state.engageCooldown = RESUME_GRACE

  return {
    action: 'pass',
    success: true,
    summary: `${name}${sums} · ${carrier.def.name} → ${receiver.def.name}`,
  }
}

function resolveShoot(
  state: MatchState,
  encounter: Encounter,
  carrier: Player,
  action: Extract<EncounterAction, { kind: 'shoot' }>,
): EncounterResult {
  const technique = affordableTechnique(carrier, action.techniqueId, 'shoot')
  spendHp(carrier, ACTION_HP_COST.shoot + (technique?.hpCost ?? 0))

  const start = effectiveStat(carrier, 'sh') + (technique?.power ?? 0)
  // A technique that splits the defence waves that many of the rest through.
  const facing = encounter.defenders.slice(technique?.ignoresBlockers ?? 0)
  const contest = contestThrow(state, facing, start)
  const name = technique ? `${technique.name}! · ` : ''
  const sums = describeThrow('SH', start, contest.rolls, contest.power)

  if (contest.taker) {
    awardExp(state, contest.taker, 'interception')
    giveBallTo(state, contest.taker)
    return {
      action: 'shoot',
      success: false,
      summary: `${name}${sums} · blocked by ${contest.taker.def.name}`,
    }
  }

  state.ball.carrier = null
  state.phase = { kind: 'flight', flight: startShot(state, carrier, contest.power, technique) }
  state.engageCooldown = RESUME_GRACE

  return {
    action: 'shoot',
    success: true,
    summary: `${name}${sums} · ${carrier.def.name} shoots!`,
  }
}


/**
 * Resolve a requested technique, or fall back to the plain action.
 *
 * A player who cannot pay simply performs the ordinary version rather than the
 * action failing, so running low on HP degrades what you can do instead of
 * taking options away mid-decision.
 */
function affordableTechnique(
  player: Player,
  techniqueId: string | null,
  kind: 'pass' | 'shoot',
): Technique | null {
  if (!techniqueId) return null
  if (!player.def.techniques.includes(techniqueId)) return null

  const technique = findTechnique(techniqueId)
  if (technique.kind !== kind) return null
  if (!canAfford(player, ACTION_HP_COST[kind] + technique.hpCost)) return null

  return technique
}
