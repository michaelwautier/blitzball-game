import type { StatusSpec } from './types'

/**
 * Blitzball techniques.
 *
 * Following FFX, techniques attach to the action they modify rather than being
 * a separate move: shoot and pass techniques belong to the player on the ball,
 * and tackle techniques fire automatically for a defender who wins the ball
 * back. Dribbling has none, which is why breaking through is always the plain
 * option.
 *
 * Every technique costs HP on top of the action's own cost, so a squad cannot
 * lean on its best moves all match — that trade is the whole point of them.
 */

export type TechniqueKind = 'shoot' | 'pass' | 'tackle'

export interface Technique {
  id: string
  name: string
  kind: TechniqueKind
  /** HP spent on top of the base cost of the action. */
  hpCost: number
  /** Shown in the encounter menu. */
  description: string
  /** Flat bonus to the power of the shot or pass. */
  power: number
  /** Defenders whose contest is ignored entirely. Shot and pass techniques only. */
  ignoresBlockers: number
  /** Condition inflicted on the technique's target, if any. */
  inflicts?: StatusSpec
}

const technique = (t: Technique): Technique => t

export const TECHNIQUES: readonly Technique[] = [
  technique({
    id: 'jecht-shot',
    name: 'Jecht Shot',
    kind: 'shoot',
    hpCost: 24,
    description: 'Splits the defence — two blockers cannot touch it',
    power: 5,
    ignoresBlockers: 2,
  }),
  technique({
    id: 'sphere-shot',
    name: 'Sphere Shot',
    kind: 'shoot',
    hpCost: 14,
    description: 'Raw power, straight at the keeper',
    power: 9,
    ignoresBlockers: 0,
  }),
  technique({
    id: 'venom-shot',
    name: 'Venom Shot',
    kind: 'shoot',
    hpCost: 16,
    description: 'Poisons the keeper, saved or not',
    power: 2,
    ignoresBlockers: 0,
    inflicts: { kind: 'poison', duration: 8, magnitude: 3 },
  }),
  technique({
    id: 'nap-shot',
    name: 'Nap Shot',
    kind: 'shoot',
    hpCost: 16,
    description: 'Puts the keeper to sleep as it arrives',
    power: 1,
    ignoresBlockers: 0,
    inflicts: { kind: 'sleep', duration: 5, magnitude: 1 },
  }),
  technique({
    id: 'venom-pass',
    name: 'Venom Pass',
    kind: 'pass',
    hpCost: 12,
    description: 'Poisons anyone who tries to cut it out',
    power: 3,
    ignoresBlockers: 0,
    inflicts: { kind: 'poison', duration: 10, magnitude: 3 },
  }),
  technique({
    id: 'wither-pass',
    name: 'Wither Pass',
    kind: 'pass',
    hpCost: 10,
    description: 'Saps the blocking of anyone in its path',
    power: 2,
    ignoresBlockers: 0,
    inflicts: { kind: 'wither', duration: 14, magnitude: 0.4, stat: 'bl' },
  }),
  technique({
    id: 'venom-tackle',
    name: 'Venom Tackle',
    kind: 'tackle',
    hpCost: 12,
    description: 'Poisons the carrier as the ball is won',
    power: 0,
    ignoresBlockers: 0,
    inflicts: { kind: 'poison', duration: 10, magnitude: 3 },
  }),
  technique({
    id: 'wither-tackle',
    name: 'Wither Tackle',
    kind: 'tackle',
    hpCost: 10,
    description: 'Saps the endurance of whoever loses the ball',
    power: 0,
    ignoresBlockers: 0,
    inflicts: { kind: 'wither', duration: 16, magnitude: 0.35, stat: 'en' },
  }),
]

const BY_ID = new Map(TECHNIQUES.map((t) => [t.id, t]))

export function findTechnique(id: string): Technique {
  const found = BY_ID.get(id)
  if (!found) throw new Error(`Unknown technique "${id}"`)
  return found
}

export function techniquesOf(ids: readonly string[], kind: TechniqueKind): Technique[] {
  return ids.map(findTechnique).filter((t) => t.kind === kind)
}
