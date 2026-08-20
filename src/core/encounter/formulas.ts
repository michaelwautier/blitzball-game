import type { Rng } from '../rng'

/**
 * The arithmetic behind every contested action.
 *
 * FFX never published its exact formulas, so these are a faithful reconstruction
 * of the shape the community documented: a stat is *rolled upward* from its base
 * rather than used flat, which is what lets a weaker player occasionally win an
 * exchange. Passes and shots lose power over distance, defenders in the way take
 * a bite out of them, and a keeper's catch is a straight contest against
 * whatever power is left.
 *
 * Everything here is pure and takes its randomness as an argument, so the whole
 * system is testable and a match replays identically from its seed. This module
 * is also the only place balance constants live — tuning the game means editing
 * numbers here, not logic elsewhere.
 */

/** A roll returns the stat plus up to this fraction of itself. */
export const ROLL_HEADROOM = 0.5

/**
 * Power a pass loses per world unit travelled.
 *
 * Tuned against simulated matches: at 0.15 a typical low-level PA of 5–8 was
 * spent before the ball crossed halfway, so no side could ever build an attack
 * and every match died in midfield.
 */
export const PASS_DECAY_PER_UNIT = 0.08

/** Power a shot loses per world unit travelled. Steeper than a pass, so range matters. */
export const SHOT_DECAY_PER_UNIT = 0.15

/**
 * Fraction of a defender's BL deducted from a pass or shot they contest.
 *
 * Well under 1, or one good blocker smothers any attempt outright — which is
 * exactly what happened at 0.35, where a single defender reliably killed a pass
 * and possession never survived a change of area.
 */
export const BLOCK_FACTOR = 0.2

/** How close to the ball in flight a defender must be to contest it. */
export const CONTEST_RADIUS = 4.5

/**
 * Roll a stat upward from its base: a value in `[stat, stat * 1.5]`.
 *
 * Rolling up rather than around the base means a stat is a floor on what a
 * player can produce, so a favourite is never helpless but an underdog can still
 * land a surprise.
 */
export function rollStat(stat: number, rng: Rng): number {
  if (stat <= 0) return 0
  return stat + rng.int(0, Math.floor(stat * ROLL_HEADROOM))
}

/** Combined tackle strength of every defender engaging a carrier. */
export function tackleTotal(attackStats: readonly number[], rng: Rng): number {
  return attackStats.reduce((total, at) => total + rollStat(at, rng), 0)
}

/** Starting power of a pass, before anyone contests it. */
export function passPower(pa: number, distance: number, rng: Rng): number {
  return Math.max(0, rollStat(pa, rng) - distance * PASS_DECAY_PER_UNIT)
}

/** Starting power of a shot, before anyone contests it. */
export function shotPower(sh: number, distance: number, rng: Rng): number {
  return Math.max(0, rollStat(sh, rng) - distance * SHOT_DECAY_PER_UNIT)
}

/** Power removed by a defender who gets in the way of a pass or shot. */
export function contestReduction(bl: number, rng: Rng): number {
  return rollStat(bl, rng) * BLOCK_FACTOR
}

/**
 * Whether the keeper claims a shot. Ties go to the keeper, so a shot has to
 * genuinely beat the catch rather than merely match it.
 */
export function keeperSaves(power: number, ca: number, rng: Rng): boolean {
  return rollStat(ca, rng) >= power
}
