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

/**
 * Power a shot loses per world unit travelled. Steeper than a pass, so range
 * matters more.
 *
 * Ours, like the pass rate — the source gives no number — and one of the three
 * constants that swing the whole board. Moved twice, both times to hold the goal
 * rate steady while something else changed underneath it: from 0.5 to 0.47 in
 * #46, to give back what freezing the pool during flight took (#39 cost a fifth
 * of all goals, 2.37 to 1.92, because defenders no longer drift out of shape
 * while the ball travels), and to 0.468 alongside the enlarged pool.
 *
 * It is far more sensitive here than the digits suggest, and the extra one is
 * not false precision. At the current size 0.470 gives 2.14 goals a match and
 * 0.468 gives 2.49 — most of the range lives in that fifth of a hundredth,
 * while 0.468 to 0.460 only carries it from 2.49 to 2.63. Shots arrive with
 * single digits of power against a keeper's catch, so a small change in what
 * survives the journey tips a whole population of them across the line at once.
 * Re-measure rather than interpolate.
 *
 * Chosen over the alternatives because it moves the rate and nothing else. The
 * blocker coverage weights reach 2.25 and then saturate however far they fall,
 * and on the way they redistribute strength between the sides — Besaid lose a
 * quarter of their points to it. `SHOOTING_STANDOFF` is far too blunt to aim
 * with: four hundredths of the pool either way is the difference between one
 * goal a match and nearly six.
 */
export const SHOT_DECAY_PER_UNIT = 0.468 * (REFERENCE_POOL_RADIUS / POOL_RADIUS)

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

/**
 * A keeper's catch swings far wider than any other roll.
 *
 * Every other contest in the game is many-against-one and repeated dozens of
 * times a match, so a narrow band averages out into something that reads as
 * skill. A save is neither: it happens a handful of times, once, alone, and it
 * decides the scoreline outright.
 *
 * At the ordinary 50–150% band it decided rather more than that. A shot reaches
 * goal with single digits of power left, so the outcome came down to the ratio
 * of two small numbers — and across the six real squads the keepers' catch
 * stats sit at 5, 6, 8, 9, 9 and 18. Those four points between Keepa and Raudy
 * were the difference between conceding fifteen a match and never conceding at
 * all: four of the six sides went a whole season without letting one in, and the
 * Aurochs shipped over a thousand. Widening the band restores the gradient the
 * catch stat is supposed to describe, so a good keeper is beaten now and again
 * and a poor one still pulls one out.
 *
 * It is also the honest picture of the act. A keeper facing a ball flung at a
 * corner of an open ring either reads it or is wrong-footed, and that is a
 * bigger swing than leaning into a tackle.
 */
export const CATCH_ROLL_MIN = 0.2
export const CATCH_ROLL_MAX = 2

/**
 * What a keeper brings before the roll: a floor, plus their catch stat.
 *
 * Anyone standing in front of the ring stops some of what comes at it. CA says
 * how much better than that they are, not whether they are a goalkeeper at all —
 * and taken as the whole story it made the six squads' keepers incomparable
 * rather than merely unequal. Their stats are 5, 6, 8, 9, 9 and 18; used raw
 * that is a factor of nearly four on the one number a scoreline turns on, so
 * Keepa conceded almost everything and Nimrook conceded nothing. The floor
 * compresses the same ordering into something a match can be played against:
 * Keepa reaches 7 against Nimrook's 14.8, still a gulf, no longer a verdict.
 */
export const CATCH_FLOOR = 4
export const CATCH_PER_POINT = 0.6

/** A keeper's catch before the roll, floor included. */
export function catchStrength(stat: number): number {
  return CATCH_FLOOR + Math.max(0, stat) * CATCH_PER_POINT
}

/** Roll a keeper's catch against an arriving shot. See the band above. */
export function rollCatch(stat: number, rng: Rng): number {
  return Math.max(0, Math.round(catchStrength(stat) * rng.range(CATCH_ROLL_MIN, CATCH_ROLL_MAX)))
}

/**
 * The catch a shooter should expect to have to beat: the middle of the band.
 *
 * What the AI judges a shot against. It is not `stat` itself — the band is not
 * centred on 1 — and using the stat directly made shooters respect good keepers
 * so much that they declined to shoot at all, for entire matches.
 */
export function expectedCatch(stat: number): number {
  return catchStrength(stat) * ((CATCH_ROLL_MIN + CATCH_ROLL_MAX) / 2)
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

/**
 * How far a throw with this much power can carry before it arrives spent.
 *
 * The inverse of `passDecay`, and the number FFX is really describing when it
 * calls PA a passing *range*: a pass is not weak or strong, it either gets there
 * or it does not. Expressed in world units so it can be compared directly
 * against the distance to a teammate.
 */
export function passRange(power: number): number {
  return Math.max(0, power) / PASS_DECAY_PER_UNIT
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

/**
 * HP drained per second by the player carrying the ball.
 *
 * Carrying is work. FFX shows the carrier's HP falling as they swim, and it is
 * what stops holding the ball being free: a carrier who dawdles arrives at the
 * decision with less to spend on the technique they wanted.
 *
 * Previously the carrier was merely denied the regen everyone else gets, which
 * is not the same thing — it made carrying cost nothing except the opportunity
 * to recover, so a fresh player could dribble indefinitely.
 *
 * Sized against the real HP pools of 90–389 and the 2–5 an action costs: about
 * twenty seconds on the ball is worth one shot's worth of stamina. Floored at
 * zero, so the penalty for running dry stays exhaustion — half stats — rather
 * than anything new.
 */
export const CARRY_DRAIN_PER_SECOND = 0.5
