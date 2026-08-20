import { GOAL_HALF_HEIGHT, clampToPool, goalLineX, type Vec2 } from '../pitch'
import { PASS_DECAY_PER_UNIT, SHOT_DECAY_PER_UNIT, rollStat } from '../encounter/formulas'
import { attackDirection } from './formation'
import { PLAYER_RADIUS, recordPrevious } from './movement'
import { distanceBetween, keeperFor, opponentOf } from './queries'
import { giveBallTo } from './possession'
import { awardExp } from './exp'
import { applyStatus } from './status'
import { effectiveStat } from './stats'
import type { Technique } from '../../data/techniques'
import type { BallFlight, MatchState, Player, TeamId } from './types'

/** How fast a pass or shot travels, in world units per second. */
export const FLIGHT_SPEED = 46

/**
 * Launch a pass towards a teammate.
 *
 * Whatever the defenders left of the passer's PA is what sets off; the throw
 * then bleeds power over the distance it has to cover, which is what FFX means
 * by PA being a passing *range* rather than a passing strength.
 */
export function startPass(
  passer: Player,
  receiver: Player,
  power: number,
  technique: Technique | null = null,
): BallFlight {
  return {
    kind: 'pass',
    fromTeam: passer.team,
    passerId: passer.id,
    targetId: receiver.id,
    target: { x: receiver.x, y: receiver.y },
    power,
    technique,
    blockersIgnored: technique?.ignoresBlockers ?? 0,
  }
}

/** Launch a shot at the goal this player is attacking. */
export function startShot(
  state: MatchState,
  shooter: Player,
  power: number,
  technique: Technique | null = null,
): BallFlight {
  return {
    kind: 'shot',
    fromTeam: shooter.team,
    passerId: shooter.id,
    targetId: null,
    target: aimPoint(state, shooter),
    power,
    technique,
    blockersIgnored: technique?.ignoresBlockers ?? 0,
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
 * Advance a ball in flight.
 *
 * The contest is over by the time anything is in the air: only the defenders who
 * actually engaged the carrier get to interfere, and they did so at the
 * encounter. What remains is distance — the throw bleeds power as it travels,
 * and one that runs out before arriving is beyond the passer's range.
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
  const travel = Math.min(FLIGHT_SPEED * dt, remaining)

  if (remaining > 0) {
    ball.x += (dx / remaining) * travel
    ball.y += (dy / remaining) * travel
    ball.vx = (dx / remaining) * FLIGHT_SPEED
    ball.vy = (dy / remaining) * FLIGHT_SPEED
  }

  const decayRate = flight.kind === 'pass' ? PASS_DECAY_PER_UNIT : SHOT_DECAY_PER_UNIT
  flight.power -= travel * decayRate

  if (flight.power <= 0) {
    overhit(state, flight)
    return
  }

  if (remaining <= travel) {
    if (flight.kind === 'shot') resolveShotArrival(state, flight)
    else resolvePassArrival(state, flight)
  }
}

/**
 * The ball ran out of power in the air.
 *
 * Not a loose ball: FFX is specific that the intended receiver fumbles it and
 * the opposition collects, so throwing beyond your range is a turnover rather
 * than a coin toss.
 */
function overhit(state: MatchState, flight: BallFlight): void {
  state.phase = { kind: 'play' }
  const claimant = nearestOpponent(state, flight.fromTeam)

  if (!claimant) {
    state.ball.vx = 0
    state.ball.vy = 0
    return
  }

  giveBallTo(state, claimant)
  state.announcement =
    flight.kind === 'pass'
      ? `Out of range — ${claimant.def.name} collects`
      : `${claimant.def.name} gathers the loose shot`
}

/** The closest opponent to the ball, to collect an overhit throw. */
function nearestOpponent(state: MatchState, fromTeam: TeamId): Player | undefined {
  let best: Player | undefined
  let bestDistance = Infinity

  for (const player of state.players) {
    if (player.team === fromTeam) continue
    const distance = distanceBetween(player, state.ball)
    if (distance < bestDistance) {
      bestDistance = distance
      best = player
    }
  }
  return best
}

function resolvePassArrival(state: MatchState, flight: BallFlight): void {
  const receiver = state.players.find((p) => p.id === flight.targetId)

  if (!receiver) {
    overhit(state, flight)
    return
  }

  state.phase = { kind: 'play' }
  // The passer is credited, not the receiver: finding someone is the skill.
  awardExp(
    state,
    state.players.find((p) => p.id === flight.passerId),
    'pass',
  )
  giveBallTo(state, receiver)
  state.announcement = `${receiver.def.name} receives`
}

/**
 * The shot arrives, and the keeper takes their bite out of whatever is left of
 * it. Anything still standing after that is a goal.
 */
function resolveShotArrival(state: MatchState, flight: BallFlight): void {
  const keeper = keeperFor(state, opponentOf(flight.fromTeam))
  const shooter = state.players.find((p) => p.id === flight.passerId)
  awardExp(state, shooter, 'shot')

  // A shot technique lands on the keeper as it arrives, before the catch, so a
  // Nap Shot is genuinely a way past a keeper you could not otherwise beat.
  if (keeper && flight.technique?.inflicts && flight.technique.kind === 'shoot') {
    applyStatus(keeper, flight.technique.inflicts)
  }

  if (keeper) {
    flight.power -= rollStat(effectiveStat(keeper, 'ca'), state.rng)

    if (flight.power <= 0) {
      awardExp(state, keeper, 'save')
      giveBallTo(state, keeper)
      clearAreaAroundKeeper(state, keeper)
      state.engageCooldown = KEEPER_CLEARANCE_GRACE
      state.phase = { kind: 'play' }
      state.announcement = `${keeper.def.name} saves!`
      return
    }
  }

  awardExp(state, shooter, 'goal')
  state.teams[flight.fromTeam].score += 1
  state.phase = { kind: 'celebration', scorer: flight.fromTeam, timer: CELEBRATION_SECONDS }
  state.announcement = 'GOAL!'
  state.ball.carrier = null
  state.ball.vx = 0
  state.ball.vy = 0
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
    // Moved rather than swum: without this the renderer interpolates from where
    // they used to be, drawing them in two places.
    recordPrevious(player)
  }
}
