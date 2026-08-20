import type { PlayerStats } from '../../data/types'
import { hasStatus, witherFactor } from './status'
import type { Player } from './types'

/**
 * What a player can actually produce right now.
 *
 * Every contested calculation reads stats through here rather than from
 * `player.def.stats`, so exhaustion and conditions apply everywhere at once and
 * the printed stat block stays a permanent description of the player.
 */

/** Fraction of a stat still available to a player who has run out of HP. */
export const EXHAUSTED_FACTOR = 0.5

/** Fraction of a stat available to a sleeping player. */
export const ASLEEP_FACTOR = 0.2

/** HP at or below which a player is considered spent. */
export const EXHAUSTED_AT = 0

export function isExhausted(player: Player): boolean {
  return player.hp <= EXHAUSTED_AT
}

export function isAsleep(player: Player): boolean {
  return hasStatus(player, 'sleep')
}

/**
 * A single stat after exhaustion, sleep and wither.
 *
 * Never returns less than 1 for a stat that started above zero: a spent, poisoned
 * player is close to useless but still contests, which keeps a match from
 * degenerating into free goals late on.
 */
export function effectiveStat(player: Player, key: keyof PlayerStats): number {
  const base = player.def.stats[key]
  if (base <= 0) return 0

  let value = base * witherFactor(player, key)
  if (isExhausted(player)) value *= EXHAUSTED_FACTOR
  if (isAsleep(player)) value *= ASLEEP_FACTOR

  return Math.max(1, Math.round(value))
}

/** The whole stat block, adjusted. Convenient where several stats are needed. */
export function effectiveStats(player: Player): PlayerStats {
  return {
    hp: player.def.stats.hp,
    sp: effectiveStat(player, 'sp'),
    en: effectiveStat(player, 'en'),
    at: effectiveStat(player, 'at'),
    pa: effectiveStat(player, 'pa'),
    bl: effectiveStat(player, 'bl'),
    sh: effectiveStat(player, 'sh'),
    ca: effectiveStat(player, 'ca'),
  }
}

/** Spend HP, never dropping below zero. */
export function spendHp(player: Player, amount: number): void {
  player.hp = Math.max(0, player.hp - amount)
}

/** Whether this player can afford an action costing `amount`. */
export function canAfford(player: Player, amount: number): boolean {
  return player.hp >= amount
}
