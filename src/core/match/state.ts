import { Rng } from '../rng'
import { BALL_RADIUS, POOL_RADIUS, clampToPool } from '../pitch'
import { POSITION_KEYS, type TeamDef } from '../../data/types'
import { findPlayer } from '../../data/teams'
import { steerByRole } from '../ai/positioning'
import { kickoffPosition } from './formation'
import { PLAYER_RADIUS, recordPrevious, steerWithIntent, type Movable } from './movement'
import { carrierOf, speedOf } from './queries'
import {
  NO_INPUT,
  USER_TEAM,
  type MatchInput,
  type MatchState,
  type Player,
  type TeamId,
  type TeamState,
} from './types'

export * from './types'

/** How close a player must be to collect a loose ball. */
const PICKUP_RADIUS = PLAYER_RADIUS + BALL_RADIUS + 0.6

/** Seconds a loose ball is uncollectable for, so a loss is not undone instantly. */
const PICKUP_COOLDOWN = 0.4

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
    rng,
    teams,
    players: [...buildSide(teams.home), ...buildSide(teams.away)],
    ball: { x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0, carrier: null },
    controlled: '',
    pickupCooldown: 0,
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
  state.controlled = chooseControlled(state)
}

export function stepMatch(state: MatchState, dt: number, input: MatchInput = NO_INPUT): void {
  state.elapsed += dt
  state.pickupCooldown = Math.max(0, state.pickupCooldown - dt)

  for (const player of state.players) recordPrevious(player)
  recordPrevious(state.ball)

  state.controlled = chooseControlled(state)

  for (const player of state.players) {
    if (player.id === state.controlled) {
      steerWithIntent(player, input.move, speedOf(player, state), dt)
    } else {
      steerByRole(state, player, dt)
    }
  }

  separatePlayers(state)
  updateBall(state, dt)
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

  for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
    for (let i = 0; i < state.players.length; i++) {
      for (let j = i + 1; j < state.players.length; j++) {
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
        a.x -= nx
        a.y -= ny
        b.x += nx
        b.y += ny
      }
    }
  }

  for (const player of state.players) {
    const inside = clampToPool(player, PLAYER_RADIUS)
    player.x = inside.x
    player.y = inside.y
  }
}

/** Take the ball off its carrier and leave it loose, briefly uncollectable. */
export function releaseBall(state: MatchState, vx: number, vy: number): void {
  state.ball.carrier = null
  state.ball.vx = vx
  state.ball.vy = vy
  state.pickupCooldown = PICKUP_COOLDOWN
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

/** Hand a loose ball to the nearest player in range. */
function collectLooseBall(state: MatchState): void {
  let claimant: Player | undefined
  let bestDistance = PICKUP_RADIUS
  for (const player of state.players) {
    const distance = Math.hypot(player.x - state.ball.x, player.y - state.ball.y)
    if (distance < bestDistance) {
      bestDistance = distance
      claimant = player
    }
  }
  if (claimant) state.ball.carrier = claimant.id
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
