import { attackDirection } from './formation'
import { CARRY_SPEED_FACTOR, maxSpeed } from './movement'
import type { MatchState, Player, TeamId } from './types'

export function playerById(state: MatchState, id: string): Player | undefined {
  return state.players.find((p) => p.id === id)
}

/** The player currently in possession, if any. */
export function carrierOf(state: MatchState): Player | undefined {
  return state.ball.carrier === null ? undefined : playerById(state, state.ball.carrier)
}

/** Top speed for this player right now, accounting for carrying the ball. */
export function speedOf(player: Player, state: MatchState): number {
  const base = maxSpeed(player.def.stats)
  return state.ball.carrier === player.id ? base * CARRY_SPEED_FACTOR : base
}

/** Which way along x this player's team attacks. */
export function attackDirectionOf(state: MatchState, team: TeamId): 1 | -1 {
  return attackDirection(state.teams[team].defending)
}

export function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * The `count` players from `team` closest to `point`, nearest first, skipping
 * keepers so they are never dragged out of goal.
 */
export function nearestOutfielders(
  state: MatchState,
  team: TeamId,
  point: { x: number; y: number },
  count: number,
): Player[] {
  return state.players
    .filter((p) => p.team === team && p.slot !== 'GK')
    .sort((a, b) => distanceBetween(a, point) - distanceBetween(b, point))
    .slice(0, count)
}
