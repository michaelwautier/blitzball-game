import type { PlayerDef, PlayerStats } from '../../data/types'

/**
 * A player's progress across matches.
 *
 * Deliberately separate from `PlayerDef`, which stays a permanent description of
 * who a player is. A career is the mutable half — what they have earned — so the
 * same roster data can be reused for a fresh save, an opponent's squad, or a
 * simulated fixture without anything leaking between them.
 */

export const MAX_LEVEL = 99

/** The stat keys that can grow, in the order they are shown. */
export const GROWABLE: readonly (keyof PlayerStats)[] = [
  'hp',
  'sp',
  'en',
  'at',
  'pa',
  'bl',
  'sh',
  'ca',
]

export interface PlayerCareer {
  playerId: string
  level: number
  /** Experience banked towards the next level. */
  exp: number
  /**
   * Accumulated growth, as fractions. The whole part is what the player
   * actually has; keeping the remainder means a curve of 0.5 reliably yields a
   * point every second level rather than being rounded away each time.
   */
  gains: PlayerStats
}

const zeroed = (): PlayerStats => ({
  hp: 0,
  sp: 0,
  en: 0,
  at: 0,
  pa: 0,
  bl: 0,
  sh: 0,
  ca: 0,
})

/** A fresh career: level one, nothing earned yet. */
export function createCareer(playerId: string): PlayerCareer {
  return { playerId, level: 1, exp: 0, gains: zeroed() }
}

/** Experience needed to go from `level` to the next one. */
export function expForNextLevel(level: number): number {
  return 30 + (level - 1) * 15
}

/** A player's stats now: their base, plus whatever their career has earned. */
export function currentStats(def: PlayerDef, career: PlayerCareer | undefined): PlayerStats {
  if (!career) return { ...def.stats }

  const stats = { ...def.stats }
  for (const key of GROWABLE) {
    stats[key] = def.stats[key] + Math.floor(career.gains[key])
  }
  return stats
}

export interface LevelUp {
  level: number
  /** Whole stat points gained at this level, omitting stats that did not move. */
  increases: Partial<Record<keyof PlayerStats, number>>
}

export interface CareerProgress {
  playerId: string
  name: string
  expGained: number
  levelBefore: number
  levelAfter: number
  levelUps: LevelUp[]
  /** Total whole points gained per stat across every level in this award. */
  totalIncreases: Partial<Record<keyof PlayerStats, number>>
}

/**
 * Bank experience and level the player up as far as it takes them.
 *
 * Returns what changed rather than only mutating, so a summary screen can report
 * it without recomputing anything. Levelling can cascade: a big match may be
 * worth more than one level, and each is reported separately.
 */
export function awardExperience(
  def: PlayerDef,
  career: PlayerCareer,
  exp: number,
): CareerProgress {
  const levelBefore = career.level
  const levelUps: LevelUp[] = []
  const totalIncreases: Partial<Record<keyof PlayerStats, number>> = {}

  career.exp += Math.max(0, exp)

  while (career.level < MAX_LEVEL && career.exp >= expForNextLevel(career.level)) {
    career.exp -= expForNextLevel(career.level)
    career.level += 1

    const increases: Partial<Record<keyof PlayerStats, number>> = {}
    for (const key of GROWABLE) {
      const before = Math.floor(career.gains[key])
      career.gains[key] += def.growth[key]
      const gained = Math.floor(career.gains[key]) - before
      if (gained > 0) {
        increases[key] = gained
        totalIncreases[key] = (totalIncreases[key] ?? 0) + gained
      }
    }

    levelUps.push({ level: career.level, increases })
  }

  // At the cap there is nothing left to bank towards.
  if (career.level >= MAX_LEVEL) career.exp = 0

  return {
    playerId: career.playerId,
    name: def.name,
    expGained: Math.max(0, exp),
    levelBefore,
    levelAfter: career.level,
    levelUps,
    totalIncreases,
  }
}
