import { Rng } from '../rng'
import { BALL_RADIUS, POOL_RADIUS, clampToPool } from '../pitch'
import { POSITION_KEYS, type TeamDef } from '../../data/types'
import { findPlayer } from '../../data/teams'
import { desiredPosition } from '../ai/positioning'
import { chooseEncounterAction } from '../ai/decisions'
import { engagingDefenders, openEncounter, resolveEncounter } from '../encounter/encounter'
import { kickoffPosition } from './formation'
import { stepFlight } from './flight'
import {
  PLAYER_RADIUS,
  recordPrevious,
  steerTowards,
  steerWithIntent,
  type Movable,
} from './movement'
import { collectLooseBall } from './possession'
import { carrierOf, speedOf } from './queries'
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

export function createMatch(home: TeamDef, away: TeamDef, seed: number | string): MatchState {
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
    players: [...buildSide(teams.home), ...buildSide(teams.away)],
    ball: { x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0, carrier: null },
    controlled: '',
    pickupCooldown: 0,
    engageCooldown: 0,
    endurance: 0,
    announcement: null,
    announcementTimer: 0,
  }

  resetForKickoff(state)
  return state
}

function buildSide(team: TeamState): Player[] {
  return POSITION_KEYS.map((slot) => {
    const def = findPlayer(team.def, team.def.lineup[slot])
    const spot = kickoffPosition(slot, team.defending)
    return {
      id: `${team.id}:${def.id}`,
      def,
      team: team.id,
      slot,
      x: spot.x,
      y: spot.y,
      prevX: spot.x,
      prevY: spot.y,
      vx: 0,
      vy: 0,
      hp: def.stats.hp,
    }
  })
}

/** Return every player to their kickoff spot and drop the ball at the centre. */
export function resetForKickoff(state: MatchState): void {
  for (const player of state.players) {
    const spot = kickoffPosition(player.slot, state.teams[player.team].defending)
    player.x = spot.x
    player.y = spot.y
    player.prevX = spot.x
    player.prevY = spot.y
    player.vx = 0
    player.vy = 0
  }

  const { ball } = state
  ball.x = 0
  ball.y = 0
  ball.prevX = 0
  ball.prevY = 0
  // A touch of scatter so a kickoff is never a perfectly symmetrical race.
  ball.vx = state.rng.range(-1.5, 1.5)
  ball.vy = state.rng.range(-1.5, 1.5)
  ball.carrier = null

  state.pickupCooldown = 0
  state.engageCooldown = 0
  state.endurance = 0
  state.phase = { kind: 'play' }
  state.controlled = chooseControlled(state)
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
      stepEncounter(state, dt, state.phase.encounter)
      break
    case 'flight': {
      const { flight } = state.phase
      runClock(state, dt)
      movePlayers(state, dt, input)
      stepFlight(state, flight, dt)
      state.controlled = chooseControlled(state)
      break
    }
    case 'celebration':
      state.phase.timer -= dt
      if (state.phase.timer <= 0) resetForKickoff(state)
      break
    case 'halfTime':
      state.phase.timer -= dt
      if (state.phase.timer <= 0) startSecondHalf(state)
      break
    case 'fullTime':
      break
  }
}

function stepPlay(state: MatchState, dt: number, input: MatchInput): void {
  state.pickupCooldown = Math.max(0, state.pickupCooldown - dt)
  state.engageCooldown = Math.max(0, state.engageCooldown - dt)

  runClock(state, dt)
  if (state.phase.kind !== 'play') return

  movePlayers(state, dt, input)
  updateBall(state, dt)
  maybeOpenEncounter(state)
  state.controlled = chooseControlled(state)
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
    const target = targets[index]
    const speed = speedOf(player, state)
    if (target) steerTowards(player, target, speed, dt)
    else steerWithIntent(player, input.move, speed, dt)
  })

  separatePlayers(state)
}

/** Freeze play and open an encounter once defenders have closed the carrier down. */
function maybeOpenEncounter(state: MatchState): void {
  if (state.engageCooldown > 0) return

  const carrier = carrierOf(state)
  if (!carrier) return

  const defenders = engagingDefenders(state, carrier)
  if (defenders.length === 0) return

  state.phase = { kind: 'encounter', encounter: openEncounter(state, carrier, defenders) }
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

  if (carrier.team === USER_TEAM) return

  encounter.thinkTimer -= dt
  if (encounter.thinkTimer > 0) return

  applyEncounterAction(state, encounter, chooseEncounterAction(state, encounter))
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

  // Pass and shoot move to a flight themselves; anything else resumes open play.
  if (state.phase.kind === 'encounter') state.phase = { kind: 'play' }
}

/**
 * Pick the user's active player: whoever holds the ball, else the outfielder
 * best placed to win it. Keepers are never handed over — pulling one off its
 * line would be a gift to the opposition.
 */
function chooseControlled(state: MatchState): string {
  const carrier = carrierOf(state)
  if (carrier?.team === USER_TEAM) return carrier.id

  let best: Player | undefined
  let bestDistance = Infinity
  for (const player of state.players) {
    if (player.team !== USER_TEAM || player.slot === 'GK') continue
    const distance = Math.hypot(player.x - state.ball.x, player.y - state.ball.y)
    if (distance < bestDistance) {
      bestDistance = distance
      best = player
    }
  }
  return best?.id ?? state.controlled
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
