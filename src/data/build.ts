import type { PlayerDef, PlayerStats } from './types'

/**
 * How a player is written down.
 *
 * Its own module so that both the transcribed sides and the invented ones can
 * use it without importing each other — `teams.ts` pulls the expansion in to
 * build the full league, so anything the expansion needs from `teams.ts` would
 * be a cycle, and was: at module load the invented rosters ran before `stats`
 * existed.
 */

export const stats = (
  hp: number,
  sp: number,
  en: number,
  at: number,
  pa: number,
  bl: number,
  sh: number,
  ca: number,
): PlayerStats => ({ hp, sp, en, at, pa, bl, sh, ca })

/** Stat points gained per level, in the same order as `stats`. */
export const growth = (
  hp: number,
  sp: number,
  en: number,
  at: number,
  pa: number,
  bl: number,
  sh: number,
  ca: number,
): PlayerStats => ({ hp, sp, en, at, pa, bl, sh, ca })

export const player = (
  id: string,
  name: string,
  natural: PlayerDef['natural'],
  s: PlayerStats,
  g: PlayerStats,
  techniques: readonly string[] = [],
): PlayerDef => ({ id, name, natural, stats: s, growth: g, techniques })
