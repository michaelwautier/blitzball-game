import { GOAL_HALF_HEIGHT, POOL_RADIUS, clampToPool, goalLineX, type Vec2 } from '../pitch'
import { PASS_DECAY_PER_UNIT, SHOT_DECAY_PER_UNIT, rollCatch } from '../encounter/formulas'
import { attackDirection } from './formation'
import { PLAYER_RADIUS, REFERENCE_POOL_RADIUS, recordPrevious } from './movement'
import { distanceBetween, keeperFor, opponentOf } from './queries'
import { giveBallTo } from './possession'
import { awardExp } from './exp'
import { applyStatus } from './status'
import { effectiveStat } from './stats'
import type { Technique } from '../../data/techniques'
import type { BallFlight, MatchState, Player, TeamId } from './types'

/**
 * How fast a pass or shot travels, in world units per second.
 *
 * Slowed deliberately. A throw now flies its whole distance and is settled on
 * arrival, so the journey is something to watch rather than a formality: whether
 * it will get there, who is closing on the receiver, and — when it arrives
 * spent — the ball spilling on to whoever picks it up. At the old speed most of
 * that happened inside a couple of frames.
 */
export const FLIGHT_SPEED = 30 * (POOL_RADIUS / REFERENCE_POOL_RADIUS)

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
    travelled: 0,
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
    travelled: 0,
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
 * encounter. Nothing here can take the ball — a throw flies its whole distance
 * and is settled where it lands.
 */
export function stepFlight(state: MatchState, flight: BallFlight, dt: number): void {
  const { ball } = state

  // Players hold still while the ball is in the air, so this only matters for
  // someone finishing a lunge they had already committed to.
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

  flight.travelled += travel
  if (remaining > travel) return

  // Arrived. Distance is charged here rather than in the air, so a throw always
  // reaches where it was aimed.
  switch (flight.kind) {
    case 'spilled':
      return collect(state, flight)
    case 'shot':
      return resolveShotArrival(state, flight)
    case 'pass':
      return resolvePassArrival(state, flight)
  }
}

/** What a throw has left by the time it arrives. */
function powerOnArrival(flight: BallFlight): number {
  const rate = flight.kind === 'pass' ? PASS_DECAY_PER_UNIT : SHOT_DECAY_PER_UNIT
  return flight.power - flight.travelled * rate
}

/**
 * The throw arrived with nothing left, and is spilled where it landed.
 *
 * Not a loose ball: FFX is specific that the intended receiver fumbles it and
 * the opposition collects, so throwing beyond your range is a turnover rather
 * than a coin toss. The ball then *travels* to whoever collects it, as a second
 * leg with nothing to contest — so it is watched rather than teleported, and it
 * is unmistakably a fumble at the far end rather than an interception on the way.
 */
function spill(state: MatchState, flight: BallFlight, message: string): void {
  const claimant = nearestOpponent(state, flight.fromTeam)

  if (!claimant) {
    state.phase = { kind: 'play' }
    state.ball.vx = 0
    state.ball.vy = 0
    return
  }

  state.announcement = message
  state.phase = {
    kind: 'flight',
    flight: {
      ...flight,
      kind: 'spilled',
      targetId: claimant.id,
      target: { x: claimant.x, y: claimant.y },
      travelled: 0,
    },
  }
}

/** The spilled ball reaches whoever is gathering it. */
function collect(state: MatchState, flight: BallFlight): void {
  const claimant = state.players.find((player) => player.id === flight.targetId)
  state.phase = { kind: 'play' }

  if (!claimant) {
    state.ball.vx = 0
    state.ball.vy = 0
    return
  }
  giveBallTo(state, claimant)
}

/** The closest opponent to the ball, to collect a spilled throw. */
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
    spill(state, flight, 'The pass finds nobody')
    return
  }

  // Distance settled here, having flown the whole way. Beyond the passer's
  // range means the ball gets there with nothing on it and is fumbled.
  if (powerOnArrival(flight) <= 0) {
    spill(state, flight, `Out of range — ${receiver.def.name} cannot hold it`)
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

  // What survived the distance. A shot that arrives spent is gathered rather
  // than saved: the keeper never had to do anything.
  let power = powerOnArrival(flight)
  if (power <= 0) {
    spill(state, flight, 'The shot drops short')
    return
  }

  if (keeper) {
    power -= rollCatch(effectiveStat(keeper, 'ca'), state.rng)

    if (power <= 0) {
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
export const KEEPER_CLEARANCE_RADIUS = POOL_RADIUS * 0.32

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
