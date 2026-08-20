import { BALL_RADIUS } from '../pitch'
import { PLAYER_RADIUS, recordPrevious } from './movement'
import { effectiveStat } from './stats'
import type { MatchState, Player } from './types'

/** How close a player must be to collect a loose ball. */
export const PICKUP_RADIUS = PLAYER_RADIUS + BALL_RADIUS + 0.6

/** Seconds a loose ball is uncollectable for, so a loss is not undone instantly. */
export const PICKUP_COOLDOWN = 0.4

/**
 * Seconds a new carrier gets before defenders may engage them.
 *
 * Without this, winning the ball in a crowd opens an encounter on the very next
 * tick — the tackler is by definition surrounded — and possession ping-pongs
 * with no play in between.
 */
export const POSSESSION_GRACE = 1.5

/**
 * Hand the ball to a player and refresh the possession's endurance.
 *
 * Endurance is per-possession, not per-encounter: it carries across every
 * breakthrough this player attempts and only resets when the ball changes hands.
 * That is what stops a strong carrier barging through the same defence forever.
 */
export function giveBallTo(state: MatchState, player: Player): void {
  state.ball.carrier = player.id
  state.ball.vx = 0
  state.ball.vy = 0
  // Bring the ball with it rather than letting it catch up on the next tick.
  // Possession can change during a frozen encounter, or alongside a player being
  // repositioned, and in both cases the ball would otherwise sit visibly adrift
  // from whoever is supposed to be holding it.
  state.ball.x = player.x
  state.ball.y = player.y
  recordPrevious(state.ball)
  state.endurance = effectiveStat(player, 'en')
  state.pickupCooldown = 0
  state.engageCooldown = Math.max(state.engageCooldown, POSSESSION_GRACE)
}

/** Knock the ball loose, briefly uncollectable so possession cannot flip instantly. */
export function releaseBall(state: MatchState, vx = 0, vy = 0): void {
  state.ball.carrier = null
  state.ball.vx = vx
  state.ball.vy = vy
  state.pickupCooldown = PICKUP_COOLDOWN
}

/** Give a loose ball to the nearest player in range, if there is one. */
export function collectLooseBall(state: MatchState): void {
  let claimant: Player | undefined
  let bestDistance = PICKUP_RADIUS

  for (const player of state.players) {
    const distance = Math.hypot(player.x - state.ball.x, player.y - state.ball.y)
    if (distance < bestDistance) {
      bestDistance = distance
      claimant = player
    }
  }

  if (claimant) giveBallTo(state, claimant)
}
