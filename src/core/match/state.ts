import { Rng } from '../rng'
import { currentStats, type PlayerCareer } from '../progression/career'
import { BALL_RADIUS, POOL_RADIUS, clampToPool } from '../pitch'
import { POSITION_KEYS, type TeamDef } from '../../data/types'
import { findPlayer } from '../../data/teams'
import { desiredPosition } from '../ai/positioning'
import { chooseEncounterAction, shouldStopAndShoot } from '../ai/decisions'
import {
  AI_THINK_SECONDS,
  ENGAGE_RADIUS,
  MAX_ENGAGED,
  chargeCommittedDefenders,
  engagingDefenders,
  openDistribution,
  openEncounter,
  openOnTheBall,
  resolveEncounter,
} from '../encounter/encounter'
import { kickoffPosition } from './formation'
import { stepFlight } from './flight'
import {
  PLAYER_RADIUS,
  advanceLunge,
  recordPrevious,
  steerTowards,
  steerWithIntent,
  type Movable,
} from './movement'
import { collectLooseBall, giveBallTo } from './possession'
import { tickStatuses } from './status'
import { CARRY_DRAIN_PER_SECOND, HP_REGEN_PER_SECOND } from '../encounter/formulas'
import { carrierOf, distanceBetween, opponentOf, playerById, speedOf } from './queries'
import {
  NO_INPUT,
  USER_TEAM,
  type Encounter,
  type EncounterAction,
  type MatchInput,
  type MatchState,
  type Player,
  type TeamId,
  type TeamState,
} from './types'

export * from './types'

/** Length of each half, in seconds. FFX uses five minutes; three keeps a demo brisk. */
export const HALF_SECONDS = 180

/** How long the half-time break holds before the restart. */
export const HALF_TIME_SECONDS = 2.5

/** How long an announcement stays on screen. */
export const ANNOUNCEMENT_SECONDS = 1.8

/** Drag on a loose ball: the fraction of its speed retained per second. */
const BALL_DRAG = 0.35

/** How far in front of its carrier the ball rides. */
const CARRY_OFFSET = PLAYER_RADIUS + BALL_RADIUS + 0.3

/** Speed retained when a loose ball rebounds off the pool wall. */
const WALL_RESTITUTION = 0.6

/**
 * Relaxation passes used to separate overlapping players each tick. Two is
 * enough to resolve a crowd without visible jitter; one leaves stacks of three.
 */
const SEPARATION_PASSES = 2

/**
 * Careers to build a match from, keyed by the id the player has in a match
 * (`home:tidus`). Anything missing simply starts at level one.
 */
export type CareerLookup = (playerId: string) => PlayerCareer | undefined

export function createMatch(
  home: TeamDef,
  away: TeamDef,
  seed: number | string,
  careers: CareerLookup = () => undefined,
): MatchState {
  const rng = typeof seed === 'string' ? Rng.fromString(seed) : new Rng(seed)

  const teams: Record<TeamId, TeamState> = {
    home: { id: 'home', def: home, defending: 'left', score: 0 },
    away: { id: 'away', def: away, defending: 'right', score: 0 },
  }

  const state: MatchState = {
    elapsed: 0,
    clock: HALF_SECONDS,
    half: 1,
    phase: { kind: 'play' },
    rng,
    teams,
    players: [...buildSide(teams.home, careers), ...buildSide(teams.away, careers)],
    ball: { x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0, carrier: null },
    controlled: '',
    pickupCooldown: 0,
    engageCooldown: 0,
    endurance: 0,
    exp: {},
    announcement: null,
    announcementTimer: 0,
  }

  resetForKickoff(state)
  return state
}

function buildSide(team: TeamState, careers: CareerLookup): Player[] {
  return POSITION_KEYS.map((slot) => {
    const def = findPlayer(team.def, team.def.lineup[slot])
    const spot = kickoffPosition(slot, team.defending)
    const id = `${team.id}:${def.id}`
    // Snapshotted once, so the engine never has to know careers exist.
    const stats = currentStats(def, careers(id))
    return {
      id,
      def,
      team: team.id,
      slot,
      x: spot.x,
      y: spot.y,
      prevX: spot.x,
      prevY: spot.y,
      vx: 0,
      vy: 0,
      stats,
      hp: stats.hp,
      statuses: [],
      recovery: 0,
      engageCooldown: 0,
      lunge: null,
    }
  })
}

/** Return every player to their kickoff spot and drop the ball at the centre. */
/**
 * Put everyone back on their marks and restart play.
 *
 * `possession` decides how. With nobody named the ball is tossed into the middle
 * for both sides to race — FFX's blitzoff, and how each half begins. Named, that
 * side restarts with the ball, which is what happens after a goal: the side that
 * just scored does not get it back.
 *
 * Racing for it after a goal reads as neutral and is not. The scorer wins that
 * race half the time, and since play clusters around wherever the ball lands, a
 * strong side could chain a goal into the next one while the side being beaten
 * never got the ball at all.
 */
export function resetForKickoff(state: MatchState, possession: TeamId | null = null): void {
  for (const player of state.players) {
    const spot = kickoffPosition(player.slot, state.teams[player.team].defending)
    player.x = spot.x
    player.y = spot.y
    player.prevX = spot.x
    player.prevY = spot.y
    player.vx = 0
    player.vy = 0
    player.recovery = 0
    player.engageCooldown = 0
    player.lunge = null
  }

  const { ball } = state
  ball.x = 0
  ball.y = 0
  ball.prevX = 0
  ball.prevY = 0
  ball.carrier = null
  ball.vx = 0
  ball.vy = 0

  state.pickupCooldown = 0
  state.engageCooldown = 0
  state.endurance = 0
  state.phase = { kind: 'play' }

  const taker = possession ? restartTaker(state, possession) : undefined
  if (taker) {
    // Up to the centre spot to restart, with everyone else still behind their
    // own kickoff line, so the restart is not immediately contested.
    taker.x = 0
    taker.y = 0
    taker.prevX = 0
    taker.prevY = 0
    // Brings the ball, the endurance refresh and the possession grace with it.
    giveBallTo(state, taker)
  } else {
    // A touch of scatter so a kickoff is never a perfectly symmetrical race.
    ball.vx = state.rng.range(-1.5, 1.5)
    ball.vy = state.rng.range(-1.5, 1.5)
  }

  updateControlled(state)
}

/**
 * Who takes the restart: that side's midfielder.
 *
 * The same slot for every team, so a restart is predictable rather than
 * depending on who happened to be nearest when the ball went in.
 */
function restartTaker(state: MatchState, team: TeamId): Player | undefined {
  return state.players.find((player) => player.team === team && player.slot === 'MF')
}

/** Post a message for the on-screen banner. */
export function announce(state: MatchState, text: string): void {
  state.announcement = text
  state.announcementTimer = ANNOUNCEMENT_SECONDS
}

/**
 * Advance the match by one tick.
 *
 * The phase decides what a tick means: during `play` and `flight` the world
 * moves, during an `encounter` it is frozen while a decision is made, and the
 * remaining phases are timed pauses. Only `play` and `flight` run the clock, so
 * deliberating never costs you time — as in the original.
 */
export function stepMatch(state: MatchState, dt: number, input: MatchInput = NO_INPUT): void {
  state.elapsed += dt
  state.announcementTimer = Math.max(0, state.announcementTimer - dt)
  if (state.announcementTimer === 0) state.announcement = null

  switch (state.phase.kind) {
    case 'play':
      stepPlay(state, dt, input)
      break
    case 'encounter':
      holdStill(state)
      // The world is frozen, but committed movements are not: defenders settling
      // in front of the carrier, and anyone carried past by a challenge that has
      // just been made, both play out while the menu is open.
      advanceLunges(state, dt)
      stepEncounter(state, dt, state.phase.encounter)
      break
    case 'flight': {
      const { flight } = state.phase
      runClock(state, dt)
      updateCondition(state, dt)
      movePlayers(state, dt, input)
      stepFlight(state, flight, dt)
      updateControlled(state)
      break
    }
    case 'celebration':
      holdStill(state)
      state.phase.timer -= dt
      // The side that conceded restarts with it; the scorer does not get it back.
      if (state.phase.timer <= 0) resetForKickoff(state, opponentOf(state.phase.scorer))
      break
    case 'halfTime':
      holdStill(state)
      state.phase.timer -= dt
      if (state.phase.timer <= 0) startSecondHalf(state)
      break
    case 'fullTime':
      holdStill(state)
      break
  }
}

/**
 * Collapse the interpolation gap for everything on the pitch.
 *
 * The renderer draws each body between its previous and current position using
 * the fraction of a tick elapsed. That is what keeps motion smooth — but in a
 * phase where nothing moves, the previous position stays wherever the last
 * moving tick left it, so the renderer sweeps back and forth across that gap
 * every single frame. At a fraction of a unit it reads as a shimmer; after a
 * position is set directly, it reads as the body being drawn in two places.
 */
/**
 * Advance committed movements, and nothing else.
 *
 * Used where play is stopped but a body is mid-flight through a movement it has
 * already committed to. Without this a partial breakthrough left the beaten
 * defender hanging motionless at the start of their lunge until the encounter
 * ended, because lunges are otherwise only stepped inside `movePlayers`.
 */
function advanceLunges(state: MatchState, dt: number): void {
  for (const player of state.players) {
    if (!player.lunge) continue
    if (!advanceLunge(player, player.lunge, dt)) player.lunge = null
  }
}

function holdStill(state: MatchState): void {
  for (const player of state.players) recordPrevious(player)
  recordPrevious(state.ball)
}

function stepPlay(state: MatchState, dt: number, input: MatchInput): void {
  state.pickupCooldown = Math.max(0, state.pickupCooldown - dt)
  state.engageCooldown = Math.max(0, state.engageCooldown - dt)

  runClock(state, dt)
  if (state.phase.kind !== 'play') return

  updateCondition(state, dt)
  movePlayers(state, dt, input)
  updateBall(state, dt)
  maybeOpenEncounter(state)
  maybeShootOnSight(state)
  updateControlled(state)
}

/**
 * An AI carrier close enough to goal stops and takes the shot on.
 *
 * The AI only ever chooses an action inside an encounter, so an attacker nobody
 * challenged had no way to shoot and simply swam into the net. Opening the same
 * on-the-ball decision the user gets with the space bar gives them the moment to
 * pull the trigger.
 *
 * Never done for the user's own carrier: deciding when to shoot is the whole
 * point of being on the ball, and having the menu appear uninvited would take
 * that away.
 */
function maybeShootOnSight(state: MatchState): void {
  if (state.phase.kind !== 'play') return

  const carrier = carrierOf(state)
  if (!carrier || carrier.team === USER_TEAM || carrier.slot === 'GK') return
  if (!shouldStopAndShoot(state, carrier)) return

  state.phase = { kind: 'encounter', encounter: openOnTheBall(state, carrier) }
}

/**
 * Advance conditions and recover stamina.
 *
 * The player on the ball loses HP rather than gaining it: carrying is the work,
 * and everyone else is catching their breath. Poison drains faster than the
 * regen rate, so a poisoned player keeps losing ground until it wears off.
 */
function updateCondition(state: MatchState, dt: number): void {
  for (const player of state.players) {
    tickStatuses(player, dt)
    player.recovery = Math.max(0, player.recovery - dt)
    player.engageCooldown = Math.max(0, player.engageCooldown - dt)

    // Carrying costs; everyone else is catching their breath.
    if (state.ball.carrier === player.id) {
      player.hp = Math.max(0, player.hp - CARRY_DRAIN_PER_SECOND * dt)
      continue
    }

    player.hp = Math.min(player.stats.hp, player.hp + HP_REGEN_PER_SECOND * dt)
  }
}

function runClock(state: MatchState, dt: number): void {
  state.clock = Math.max(0, state.clock - dt)
  if (state.clock > 0) return

  if (state.half === 1) {
    state.phase = { kind: 'halfTime', timer: HALF_TIME_SECONDS }
    announce(state, 'Half time')
  } else {
    state.phase = { kind: 'fullTime' }
    announce(state, 'Full time')
  }
}

function startSecondHalf(state: MatchState): void {
  state.half = 2
  state.clock = HALF_SECONDS
  // Swap ends, so neither side keeps the same run of play for the whole match.
  state.teams.home.defending = state.teams.home.defending === 'left' ? 'right' : 'left'
  state.teams.away.defending = state.teams.away.defending === 'left' ? 'right' : 'left'
  resetForKickoff(state)
  announce(state, 'Second half')
}

function movePlayers(state: MatchState, dt: number, input: MatchInput): void {
  for (const player of state.players) recordPrevious(player)
  recordPrevious(state.ball)

  // `state.controlled` is deliberately NOT recomputed here. The caller built
  // this tick's input for whoever it named, and reassigning mid-tick would apply
  // that intent to a different player — which both misdirects a human's key
  // presses and, in headless simulation, steered the user's side essentially at
  // random. It is refreshed at the end of the tick instead.

  // Every player decides from the same snapshot, before anyone has moved.
  // Deciding and moving in one pass makes the result depend on array order:
  // players later in the list react to the current tick's movement while earlier
  // ones react to the previous tick's. Since the two sides occupy contiguous
  // blocks of the array, that handed the away side consistently fresher
  // information and, over a match, measurably more of the ball.
  const targets = state.players.map((player) =>
    player.id === state.controlled ? null : desiredPosition(state, player),
  )

  state.players.forEach((player, index) => {
    // Mid-challenge: carried along a committed path rather than swimming.
    if (player.lunge) {
      if (!advanceLunge(player, player.lunge, dt)) player.lunge = null
      return
    }

    // Beaten a moment ago and still turning round: no swimming either way.
    if (player.recovery > 0) {
      steerTowards(player, player, 0, dt)
      return
    }

    const target = targets[index]
    const speed = speedOf(player, state)
    if (target) steerTowards(player, target, speed, dt)
    else steerWithIntent(player, input.move, speed, dt)
  })

  separatePlayers(state)
}

/** Freeze play and open an encounter once defenders have closed the carrier down. */
function maybeOpenEncounter(state: MatchState): void {
  const carrier = carrierOf(state)
  if (!carrier) return

  // A keeper who has the ball distributes immediately, regardless of pressure:
  // holding the line and finding a teammate is the whole of their job on the
  // ball, so there is nothing to wait for.
  if (carrier.slot === 'GK') {
    state.phase = { kind: 'encounter', encounter: openDistribution(state, carrier) }
    return
  }

  if (state.engageCooldown > 0) return

  const defenders = engagingDefenders(state, carrier)
  if (defenders.length === 0) return

  state.phase = { kind: 'encounter', encounter: openEncounter(state, carrier, defenders) }
  // One line per defender, as FFX calls them out. Nearest first, matching both
  // the order they are challenged in and the order the menu lists them.
  announce(state, defenders.map((d) => `${d.def.name} on defense!`).join('\n'))
}

/**
 * Challenge the player on the ball, on purpose.
 *
 * The defending counterpart of stopping to look up. A carrier can always call a
 * halt and think; before this, a defender could only wait for one to happen to
 * them — which meant being glued to an opponent for seconds at a time with no
 * move available, while the same situation on the ball felt entirely responsive.
 *
 * Bypasses the *global* grace for exactly the reason `requestActionMenu`
 * bypasses it: that grace paces what the game does by itself, and this is a
 * person deciding to act. It does not bypass this defender's own cooldown, which
 * is what stops the key being mashed, nor being *beaten* — someone still turning
 * round after a failed tackle has nothing to challenge with — nor being out of
 * reach.
 */
export function requestChallenge(state: MatchState): boolean {
  if (state.phase.kind !== 'play') return false

  const carrier = carrierOf(state)
  if (!carrier || carrier.team === USER_TEAM) return false

  const challenger = playerById(state, state.controlled)
  if (!challenger || challenger.team !== USER_TEAM) return false
  if (challenger.slot === 'GK' || challenger.recovery > 0) return false
  // The one cooldown a deliberate challenge respects, so it cannot be mashed.
  if (challenger.engageCooldown > 0) return false
  if (distanceBetween(challenger, carrier) > ENGAGE_RADIUS) return false

  // Whoever else is already on them comes along, so a deliberate challenge and
  // one that happens by itself produce the same encounter.
  const others = engagingDefenders(state, carrier).filter((p) => p.id !== challenger.id)
  const defenders = [challenger, ...others].slice(0, MAX_ENGAGED)

  state.phase = { kind: 'encounter', encounter: openEncounter(state, carrier, defenders) }
  announce(state, defenders.map((d) => `${d.def.name} on defense!`).join('\n'))
  return true
}

/**
 * While an encounter is open the world is frozen. A user carrier holds it open
 * indefinitely, waiting for `submitEncounterAction`; an AI carrier commits after
 * a short pause so its decision is legible rather than instant.
 */
function stepEncounter(state: MatchState, dt: number, encounter: Encounter): void {
  const carrier = carrierOf(state)

  // Possession changed underneath us, or the carrier vanished: just play on.
  if (!carrier || carrier.id !== encounter.carrierId) {
    state.phase = { kind: 'play' }
    return
  }

  // The carrier does not commit until the defence has said how it is coming.
  if (encounter.awaitingDefence) return

  if (carrier.team === USER_TEAM) return

  encounter.thinkTimer -= dt
  if (encounter.thinkTimer > 0) return

  applyEncounterAction(state, encounter, chooseEncounterAction(state, encounter))
}

/**
 * Stop and look up: open the action menu on the user's carrier by choice.
 *
 * In the original you are never forced to wait for a defender before passing or
 * shooting, and the same applies here. Refused unless the user's side is
 * actually in open play with the ball, so it cannot be used to freeze the match
 * at an arbitrary moment.
 *
 * Keepers are excluded because they get their own distribution decision the
 * instant they claim the ball; there is nothing extra to request.
 */
export function requestActionMenu(state: MatchState): boolean {
  if (state.phase.kind !== 'play') return false

  const carrier = carrierOf(state)
  if (!carrier || carrier.team !== USER_TEAM || carrier.slot === 'GK') return false

  state.phase = { kind: 'encounter', encounter: openOnTheBall(state, carrier) }
  return true
}

/**
 * Back out of a decision the user opened themselves.
 *
 * Only legal for `onTheBall`: once defenders have committed, or a keeper has the
 * ball, there is no declining to decide.
 */
export function cancelActionMenu(state: MatchState): boolean {
  if (state.phase.kind !== 'encounter') return false
  if (state.phase.encounter.kind !== 'onTheBall') return false

  state.phase = { kind: 'play' }
  return true
}

/**
 * Commit how the user's defenders are challenging.
 *
 * `techniqueId` of null is a plain tackle. Answering releases the carrier to
 * make their own decision, which is why the encounter waits on this rather than
 * resolving around it.
 */
export function submitDefence(state: MatchState, techniqueId: string | null): boolean {
  if (state.phase.kind !== 'encounter') return false

  const { encounter } = state.phase
  if (!encounter.awaitingDefence) return false

  encounter.defence = { techniqueId }
  encounter.awaitingDefence = false
  return true
}

/**
 * Commit the user's choice. Ignored unless an encounter is genuinely open on a
 * player they control, so a stray click cannot act out of turn.
 */
export function submitEncounterAction(state: MatchState, action: EncounterAction): boolean {
  if (state.phase.kind !== 'encounter') return false

  const { encounter } = state.phase
  const carrier = carrierOf(state)
  if (!carrier || carrier.id !== encounter.carrierId || carrier.team !== USER_TEAM) return false
  // Their own defenders are still deciding; nothing to commit on the ball.
  if (encounter.awaitingDefence) return false

  applyEncounterAction(state, encounter, action)
  return true
}

function applyEncounterAction(
  state: MatchState,
  encounter: Encounter,
  action: EncounterAction,
): void {
  const result = resolveEncounter(state, encounter, action)
  announce(state, result.summary)

  // Past some of them but not all: still caught, and deciding again against
  // whoever is left. An AI carrier takes another moment to think about it.
  if (result.continues && state.phase.kind === 'encounter') {
    encounter.thinkTimer = AI_THINK_SECONDS
    return
  }

  // The encounter is over however it went, so everyone still in it has
  // committed and spent their moment.
  chargeCommittedDefenders(state, encounter)

  // Pass and shoot move to a flight themselves; anything else resumes open play.
  if (state.phase.kind === 'encounter') state.phase = { kind: 'play' }
}

/**
 * Keep the user's active player current.
 *
 * Exactly one case is automatic: holding the ball means steering it, so control
 * follows possession onto the carrier. Everything else is sticky. Reassigning to
 * whoever happened to be nearest the ball each tick meant control skipped
 * between defenders constantly, which made defending feel like it was happening
 * to you rather than being something you did — use `switchControlled` instead.
 *
 * A keeper on the ball is never handed over: they are rooted to their line and
 * distribute through the menu, so there is nothing to steer.
 */
function updateControlled(state: MatchState): void {
  const carrier = carrierOf(state)
  if (carrier?.team === USER_TEAM && carrier.slot !== 'GK') {
    state.controlled = carrier.id
    return
  }

  const current = playerById(state, state.controlled)
  if (current && current.team === USER_TEAM && current.slot !== 'GK') return

  // Nothing valid held — at kickoff, or after the keeper had it.
  state.controlled = nearestTo(state, state.ball)?.id ?? state.controlled
}

/**
 * Hand control to whoever is best placed to challenge the player on the ball.
 *
 * The defensive equivalent of possession following the carrier: rather than the
 * game deciding for you, this is the button that says "give me the one who can
 * actually get there".
 */
export function switchControlled(state: MatchState): boolean {
  const carrier = carrierOf(state)
  // Nothing to chase down when the ball is already ours.
  if (carrier?.team === USER_TEAM) return false

  const target = carrier ?? state.ball
  const best = nearestTo(state, target)
  if (!best || best.id === state.controlled) return false

  state.controlled = best.id
  return true
}

/** The user's closest outfielder to a point. Keepers stay on their line. */
function nearestTo(state: MatchState, point: { x: number; y: number }): Player | undefined {
  let best: Player | undefined
  let bestDistance = Infinity

  for (const player of state.players) {
    if (player.team !== USER_TEAM || player.slot === 'GK') continue
    const distance = Math.hypot(player.x - point.x, player.y - point.y)
    if (distance < bestDistance) {
      bestDistance = distance
      best = player
    }
  }
  return best
}

function updateBall(state: MatchState, dt: number): void {
  const { ball } = state
  const carrier = carrierOf(state)

  if (carrier) {
    // Ride just ahead of the carrier, in whichever direction they are swimming.
    const speed = Math.hypot(carrier.vx, carrier.vy)
    const forward = state.teams[carrier.team].defending === 'left' ? 1 : -1
    const dirX = speed > 0.1 ? carrier.vx / speed : forward
    const dirY = speed > 0.1 ? carrier.vy / speed : 0
    // Clamped, or a carrier pinned against the wall would hold the ball outside the pool.
    const spot = clampToPool(
      { x: carrier.x + dirX * CARRY_OFFSET, y: carrier.y + dirY * CARRY_OFFSET },
      BALL_RADIUS,
    )
    ball.x = spot.x
    ball.y = spot.y
    ball.vx = carrier.vx
    ball.vy = carrier.vy
    return
  }

  const retained = Math.pow(BALL_DRAG, dt)
  ball.vx *= retained
  ball.vy *= retained
  ball.x += ball.vx * dt
  ball.y += ball.vy * dt
  bounceOffBoundary(ball)

  if (state.pickupCooldown <= 0) collectLooseBall(state)
}

/**
 * Push apart players who have ended up on top of each other.
 *
 * Steering alone allows overlap — most obviously when several defenders converge
 * on a carrier pinned against the wall, where their targets clamp to the same
 * point. Resolving it positionally keeps bodies distinct without fighting the
 * steering, and matters beyond looks: the encounter system reads which defenders
 * are on the carrier, so two players at the same coordinates are ambiguous.
 */
function separatePlayers(state: MatchState): void {
  const minimum = PLAYER_RADIUS * 2
  const count = state.players.length
  const shiftX = new Float64Array(count)
  const shiftY = new Float64Array(count)

  for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
    shiftX.fill(0)
    shiftY.fill(0)

    // Every overlap is measured against the same positions and the corrections
    // applied together. Resolving pairs one at a time instead makes the outcome
    // depend on array order, which quietly favours whichever side sits later in
    // the list.
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const a = state.players[i]!
        const b = state.players[j]!
        let dx = b.x - a.x
        let dy = b.y - a.y
        let distance = Math.hypot(dx, dy)

        if (distance >= minimum) continue

        if (distance === 0) {
          // Exactly coincident: nudge along a fixed axis so the result stays deterministic.
          dx = 1
          dy = 0
          distance = 1
        }

        const push = (minimum - distance) / 2
        const nx = (dx / distance) * push
        const ny = (dy / distance) * push
        shiftX[i]! -= nx
        shiftY[i]! -= ny
        shiftX[j]! += nx
        shiftY[j]! += ny
      }
    }

    for (let i = 0; i < count; i++) {
      const player = state.players[i]!
      // A player mid-challenge still shoves others aside but is not shoved off
      // their own path, or the lunge stalls against the body it is going past.
      if (player.lunge) continue

      const inside = clampToPool(
        { x: player.x + shiftX[i]!, y: player.y + shiftY[i]! },
        PLAYER_RADIUS,
      )
      player.x = inside.x
      player.y = inside.y
    }
  }
}

/** Reflect a loose ball off the pool wall, shedding some pace on impact. */
function bounceOffBoundary(ball: Movable): void {
  const limit = POOL_RADIUS - BALL_RADIUS
  const distance = Math.hypot(ball.x, ball.y)
  if (distance <= limit || distance === 0) return

  const nx = ball.x / distance
  const ny = ball.y / distance
  ball.x = nx * limit
  ball.y = ny * limit

  const into = ball.vx * nx + ball.vy * ny
  ball.vx = (ball.vx - 2 * into * nx) * WALL_RESTITUTION
  ball.vy = (ball.vy - 2 * into * ny) * WALL_RESTITUTION
}

export { giveBallTo, releaseBall } from './possession'
