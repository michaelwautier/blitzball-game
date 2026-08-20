import { GOAL_X, POOL_RADIUS, clampToPool, type Vec2 } from '../pitch'
import { anchorFor, attackDirection, keeperPosition } from '../match/formation'
import { PLAYER_RADIUS, steerTowards } from '../match/movement'
import { carrierOf, distanceBetween, nearestOutfielders, speedOf } from '../match/queries'
import { SHOOTING_STANDOFF } from './decisions'
import type { MatchState, Player } from '../match/types'

/**
 * Off-ball movement and AI decision-making for a single player.
 *
 * Every outfielder has an anchor from their formation and drifts around it
 * based on where the ball is and who holds it. Only a couple of players ever
 * commit to the ball at once, which keeps shape rather than collapsing the whole
 * team onto the carrier.
 */

/** How strongly a player's anchor is dragged towards the ball, per axis. */
const BALL_PULL_X = 0.3
const BALL_PULL_Y = 0.45

/**
 * How many defenders leave their station to close down the carrier.
 *
 * Three rather than two since the pool was enlarged: with the same-sized bodies
 * covering a much larger pitch, two defenders left attackers running clear and
 * scoring roughly doubled. Still short of the whole side, so shape is kept.
 */
export const CHASERS = 3

/**
 * How far from the carrier a closing defender tries to settle.
 *
 * Kept inside `ENGAGE_RADIUS` so a marker who reaches its station is genuinely
 * on the carrier. Setting it wider looks tidier but deadlocks: the station is
 * relative to the carrier, so the marker simply backpedals as the carrier
 * advances and contact never happens at all.
 *
 * Encounter frequency is governed by the grace periods after each outcome, not
 * by holding defenders at arm's length.
 */
const MARKING_DISTANCE = PLAYER_RADIUS * 2

/**
 * How far apart the closing defenders fan out from one another.
 *
 * Wide enough that the third of them sits outside `ENGAGE_RADIUS`: two press the
 * ball and the spare covers the pass, rather than all three arriving on top of
 * the carrier at once.
 *
 * This is the number that decides whether an attack can go anywhere. Blocking is
 * summed across everyone engaged, so a third body on the carrier adds another
 * whole BL roll to every throw — and at level one, where a shooter carries SH 9
 * to 13 and defenders block at 8 to 14, that third roll is the difference
 * between a shot the keeper has to deal with and one that never leaves. With all
 * three engaged, four fifths of every shot in the game was blocked at the
 * encounter, and the only sides who conceded were the two whose defenders block
 * at 5 and 2.
 */
const MARKING_FAN = PLAYER_RADIUS * 3

export function steerByRole(state: MatchState, player: Player, dt: number): void {
  steerTowards(player, desiredPosition(state, player), speedOf(player, state), dt)
}

/** Where this player wants to be, given the current state of play. */
export function desiredPosition(state: MatchState, player: Player): Vec2 {
  if (player.slot === 'GK') {
    return keeperPosition(state.teams[player.team].defending, state.ball.y)
  }

  const carrier = carrierOf(state)

  if (carrier?.id === player.id) return driveTowardsGoal(state, player)

  const chasers = nearestOutfielders(
    state,
    player.team,
    carrier ?? state.ball,
    carrier && carrier.team === player.team ? 0 : CHASERS,
  )
  const rank = chasers.findIndex((p) => p.id === player.id)

  if (rank >= 0) {
    // Loose ball: go straight for it. Opponent has it: close the carrier down.
    return carrier
      ? markingSpot(state, carrier, rank)
      : clampToPool({ x: state.ball.x, y: state.ball.y }, PLAYER_RADIUS)
  }

  return supportingSpot(state, player, carrier?.team === player.team)
}

/**
 * An AI carrier heads for the opposing goal, and stops short of it.
 *
 * Aiming at the goal line itself walked attackers into the net, where they had
 * nothing to do but wait to be tackled. They now pull up at the distance they
 * are willing to shoot from.
 */
function driveTowardsGoal(state: MatchState, player: Player): Vec2 {
  const forward = attackDirection(state.teams[player.team].defending)
  return clampToPool(
    { x: forward * (GOAL_X - SHOOTING_STANDOFF), y: state.ball.y * 0.35 },
    PLAYER_RADIUS,
  )
}

/**
 * Sit between the carrier and the goal they are attacking, just off them.
 *
 * `rank` orders the defenders closing in: the first takes the carrier head on
 * and the rest fan out to one side, so they cover passing angles rather than
 * all converging on a single point.
 */
function markingSpot(state: MatchState, carrier: Player, rank: number): Vec2 {
  const forward = attackDirection(state.teams[carrier.team].defending)
  // Fan away from the nearest wall, so the spare defender is never pushed out.
  const away = carrier.y >= 0 ? -1 : 1
  return clampToPool(
    {
      x: carrier.x + forward * MARKING_DISTANCE,
      y: carrier.y + away * rank * MARKING_FAN,
    },
    PLAYER_RADIUS,
  )
}

/**
 * Hold formation, shifted towards the ball — and pushed further upfield when the
 * team is in possession, so attackers offer themselves for a pass.
 */
function supportingSpot(state: MatchState, player: Player, attacking: boolean): Vec2 {
  const anchor = anchorFor(player.slot, state.teams[player.team].defending)
  const forward = attackDirection(state.teams[player.team].defending)
  const push = attacking ? POOL_RADIUS * 0.16 : 0

  return clampToPool(
    {
      x: anchor.x + (state.ball.x - anchor.x) * BALL_PULL_X + forward * push,
      y: anchor.y + (state.ball.y - anchor.y) * BALL_PULL_Y,
    },
    PLAYER_RADIUS,
  )
}

/** Exported for tests: is this player one of the two closing down the ball? */
export function isChasing(state: MatchState, player: Player): boolean {
  const carrier = carrierOf(state)
  if (player.slot === 'GK') return false
  if (carrier?.id === player.id) return false
  if (carrier && carrier.team === player.team) return false
  return nearestOutfielders(state, player.team, carrier ?? state.ball, CHASERS).some(
    (p) => p.id === player.id,
  )
}

/** Exported for tests: how far this player is from the ball. */
export function distanceToBall(state: MatchState, player: Player): number {
  return distanceBetween(player, state.ball)
}
