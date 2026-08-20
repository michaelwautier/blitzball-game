import { POOL_RADIUS } from '../pitch'
import { REFERENCE_POOL_RADIUS } from '../match/movement'
import type { Rng } from '../rng'

/**
 * The arithmetic behind every contested action.
 *
 * These follow FFX's own description of blitzball rather than being invented: a
 * *defending* stat is rolled at 50–150% of its value and subtracted from the
 * attacking stat, and whatever survives decides the outcome. The attacking stat
 * is used at face value — the uncertainty lives in the challenge, not in what
 * the player on the ball brings to it.
 *
 *   Breakthrough  EN − each defender's AT roll            ≤ 0 loses the ball
 *   Pass          PA − each defender's BL roll, then decay over the throw
 *   Shot          SH − each defender's BL roll, then decay, then the keeper's CA
 *
 * Everything here is pure and takes its randomness as an argument, so the whole
 * system is testable and a match replays identically from its seed. This module
 * is also the only place balance constants live.
 */

/** A contested stat is rolled between these fractions of its value. */
export const ROLL_MIN = 0.5
export const ROLL_MAX = 1.5

/**
 * Power a pass loses per world unit travelled.
 *
 * FFX describes PA as a player's "effective passing range", so distance eats
 * into it directly. The rate is ours — the source gives no number — set so a
 * low-level passer can reliably find someone nearby but not across the pool.
 */
export const PASS_DECAY_PER_UNIT = 0.06 * (REFERENCE_POOL_RADIUS / POOL_RADIUS)

/** Power a shot loses per world unit travelled. Steeper, so range matters more. */
export const SHOT_DECAY_PER_UNIT = 0.5 * (REFERENCE_POOL_RADIUS / POOL_RADIUS)

/**
 * Roll a contested stat: between half and one and a half times its value.
 *
 * The width of that band is what lets a weak defender occasionally strip a
 * strong carrier, and a good one occasionally miss entirely. It is the texture
 * the whole game rests on.
 */
export function rollStat(stat: number, rng: Rng): number {
  if (stat <= 0) return 0
  return Math.max(0, Math.round(stat * rng.range(ROLL_MIN, ROLL_MAX)))
}

/** The least and most a stat can roll, matching `rollStat`'s bounds exactly. */
export function rollBounds(stat: number): { min: number; max: number } {
  if (stat <= 0) return { min: 0, max: 0 }
  return { min: Math.round(stat * ROLL_MIN), max: Math.round(stat * ROLL_MAX) }
}

/** Combined tackle of every defender engaging a carrier. */
export function tackleTotal(attackStats: readonly number[], rng: Rng): number {
  return attackStats.reduce((total, at) => total + rollStat(at, rng), 0)
}

/** Power lost by a pass crossing `distance` units. */
export function passDecay(distance: number): number {
  return distance * PASS_DECAY_PER_UNIT
}

/** Power lost by a shot crossing `distance` units. */
export function shotDecay(distance: number): number {
  return distance * SHOT_DECAY_PER_UNIT
}

/**
 * HP spent by the plain version of each action, before any technique cost.
 *
 * Sized against the real level-one HP pools of 90–207 so a busy match genuinely
 * tires a player out, which is what makes squad depth mean anything.
 */
export const ACTION_HP_COST = {
  breakthrough: 4,
  pass: 2,
  shoot: 5,
} as const

/**
 * HP recovered per second by a player who is not carrying the ball.
 *
 * Deliberately below the rate at which a busy player spends it, or stamina never
 * constrains anything and the best technique is simply used every single time.
 */
export const HP_REGEN_PER_SECOND = 0.35
