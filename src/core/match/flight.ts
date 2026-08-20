import { GOAL_HALF_HEIGHT, clampToPool, goalLineX, type Vec2 } from '../pitch'
import { CONTEST_RADIUS, contestReduction, keeperSaves, passPower, shotPower } from '../encounter/formulas'
import { attackDirection } from './formation'
import { PLAYER_RADIUS } from './movement'
import { distanceBetween, keeperFor, opponentOf } from './queries'
import { giveBallTo, releaseBall } from './possession'
import type { BallFlight, MatchState, Player } from './types'

/** How fast a pass or shot travels, in world units per second. */
export const FLIGHT_SPEED = 46

/** Launch a pass towards a teammate. */
export function startPass(state: MatchState, passer: Player, receiver: Player): BallFlight {
  return {
    kind: 'pass',
    fromTeam: passer.team,
    targetId: receiver.id,
    target: { x: receiver.x, y: receiver.y },
    power: passPower(passer.def.stats.pa, distanceBetween(passer, receiver), state.rng),
    contested: [],
  }
}

/** Launch a shot at the goal this player is attacking. */
export function startShot(state: MatchState, shooter: Player): BallFlight {
  const target = aimPoint(state, shooter)
  return {
    kind: 'shot',
    fromTeam: shooter.team,
    targetId: null,
    target,
    power: shotPower(shooter.def.stats.sh, distanceBetween(shooter, target), state.rng),
    contested: [],
  }
}

/**
 * Where a shot is aimed: the corner of the mouth furthest from the keeper.
 *
 * Aiming away from the keeper is what makes their positioning matter — a keeper
 * drawn to one side concedes the other.
 */
export function aimPoint(state: MatchState, shooter: Player): Vec2 {
  const attacking = state.teams[opponentOf(shooter.team)].defending
  const keeper = keeperFor(state, opponentOf(shooter.team))
  const away = keeper && keeper.y >= 0 ? -1 : 1
  return { x: goalLineX(attacking), y: away * GOAL_HALF_HEIGHT * 0.6 }
}

/**
 * Advance a ball in flight, letting defenders take bites out of it on the way.
 *
 * Returns once the ball has been dealt with; the caller is responsible for
 * nothing beyond calling this each tick while the phase is `flight`.
 */
export function stepFlight(state: MatchState, flight: BallFlight, dt: number): void {
  const { ball } = state

  // A pass homes in on its receiver, so a moving target is still reachable.
  if (flight.targetId) {
    const receiver = state.players.find((p) => p.id === flight.targetId)
    if (receiver) {
      flight.target.x = receiver.x
      flight.target.y = receiver.y
    }
  }

  const dx = flight.target.x - ball.x
  const dy = flight.target.y - ball.y
  const remaining = Math.hypot(dx, dy)
  const travel = FLIGHT_SPEED * dt

  if (remaining > travel && remaining > 0) {
    ball.x += (dx / remaining) * travel
    ball.y += (dy / remaining) * travel
    ball.vx = (dx / remaining) * FLIGHT_SPEED
    ball.vy = (dy / remaining) * FLIGHT_SPEED
    if (contestInFlight(state, flight)) return
    return
  }

  ball.x = flight.target.x
  ball.y = flight.target.y
  if (contestInFlight(state, flight)) return

  if (flight.kind === 'shot') resolveShotArrival(state, flight)
  else resolvePassArrival(state, flight)
}

/**
 * Let any defender near the ball reduce its power. Returns true if the ball was
 * taken, in which case the flight is over.
 */
function contestInFlight(state: MatchState, flight: BallFlight): boolean {
  const defendingTeam = opponentOf(flight.fromTeam)

  for (const player of state.players) {
    // Keepers contest at the goal line with CA, not in open water with BL.
    if (player.team !== defendingTeam || player.slot === 'GK') continue
    if (flight.contested.includes(player.id)) continue
    if (distanceBetween(player, state.ball) > CONTEST_RADIUS) continue

    flight.contested.push(player.id)
    flight.power -= contestReduction(player.def.stats.bl, state.rng)

    if (flight.power <= 0) {
      giveBallTo(state, player)
      state.phase = { kind: 'play' }
      state.announcement = `${player.def.name} intercepts!`
      return true
    }
  }

  return false
}

function resolvePassArrival(state: MatchState, flight: BallFlight): void {
  const receiver = state.players.find((p) => p.id === flight.targetId)
  state.phase = { kind: 'play' }

  if (receiver) {
    giveBallTo(state, receiver)
    state.announcement = `${receiver.def.name} receives`
    return
  }

  // The intended receiver is gone; leave it for whoever gets there first.
  releaseBall(state)
  state.announcement = 'Loose ball'
}

function resolveShotArrival(state: MatchState, flight: BallFlight): void {
  const keeper = keeperFor(state, opponentOf(flight.fromTeam))

  if (keeper && keeperSaves(flight.power, keeper.def.stats.ca, state.rng)) {
    giveBallTo(state, keeper)
    clearAreaAroundKeeper(state, keeper)
    state.engageCooldown = KEEPER_CLEARANCE_GRACE
    state.phase = { kind: 'play' }
    state.announcement = `${keeper.def.name} saves!`
    return
  }

  state.teams[flight.fromTeam].score += 1
  state.phase = { kind: 'celebration', scorer: flight.fromTeam, timer: CELEBRATION_SECONDS }
  state.announcement = 'GOAL!'
  releaseBall(state)
}

/** How long the goal banner holds before the restart. */
export const CELEBRATION_SECONDS = 2.2

/** Attackers are cleared out to this distance when a keeper claims the ball. */
export const KEEPER_CLEARANCE_RADIUS = 16

/** Seconds a keeper gets to distribute before anyone may close them down. */
export const KEEPER_CLEARANCE_GRACE = 3

/**
 * Push attackers out of the keeper's area after a save, as a goal kick would.
 *
 * Without it a match reaches a stable, unwatchable equilibrium: whichever side
 * wins territory first camps in the other's box, every save hands the ball to a
 * keeper who is instantly swarmed, and the pinned team never clears its lines.
 * Mirror matches between identical teams showed one side losing 5-10 purely from
 * having conceded territory first.
 *
 * Attackers are moved towards midfield — the direction they came from — so
 * nobody is stranded behind the play.
 */
function clearAreaAroundKeeper(state: MatchState, keeper: Player): void {
  const forward = attackDirection(state.teams[keeper.team].defending)

  for (const player of state.players) {
    if (player.team === keeper.team || player.slot === 'GK') continue
    if (distanceBetween(player, keeper) >= KEEPER_CLEARANCE_RADIUS) continue

    const spot = clampToPool(
      { x: keeper.x + forward * KEEPER_CLEARANCE_RADIUS, y: player.y },
      PLAYER_RADIUS,
    )
    player.x = spot.x
    player.y = spot.y
    player.vx = 0
    player.vy = 0
  }
}
