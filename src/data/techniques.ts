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
 *
 * The `power` bonuses follow the original exactly: +3 for everything, +5 for
 * Jecht Shot. Ours had drifted to a scatter of 0, 1, 2, 3, 5 and 9 invented one
 * at a time, which made a couple of them strictly better than the rest and left
 * both tackle techniques giving nothing at all.
 *
 * The HP costs deliberately do *not* follow the original, and the gap is large:
 * FFX charges 8 to 120 where we charge 10 to 24. Its whole HP economy is scaled
 * differently — a carrier there does not lose HP simply for swimming — so
 * importing those figures would make every technique unaffordable rather than
 * expensive. They are ours, sized against `ACTION_HP_COST` and the real 90–207
 * HP pools, and they are a balance question rather than a fidelity one.
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
  /**
   * Flat bonus to the stat the technique modifies: SH for a shot, PA for a
   * pass, AT for a tackle.
   *
   * FFX is strikingly uniform about this — every technique in the game gives
   * +3, and only Jecht Shot breaks it at +5. That uniformity is the point: a
   * technique is bought for what it *does* to the other player, and the flat
   * three is the small sweetener on top rather than the reason to use it.
   */
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
    // The one technique the original gives no number for: "a random amount of
    // extra SH". So there is nothing here to be faithful *to*, and this figure
    // stays ours. It is deliberately the largest — in FFX this costs 90 HP
    // against Venom Shot's 20, and a game charging four times as much for a
    // random bonus is telling you the bonus is big.
    //
    // Flattening it to 5 alongside the rest was tried and rejected on the
    // ladder: Basik carries it and is the Ronso's only shooter, and the change
    // took them from second in the table to fourth with their goals for cut by
    // two thirds. Correcting what the source specifies is fidelity; changing
    // what it leaves open is just a balance decision wearing fidelity's clothes.
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
    power: 3,
    ignoresBlockers: 0,
    inflicts: { kind: 'poison', duration: 8, magnitude: 3 },
  }),
  technique({
    id: 'nap-shot',
    name: 'Nap Shot',
    kind: 'shoot',
    hpCost: 16,
    description: 'Puts the keeper to sleep as it arrives',
    power: 3,
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
    power: 3,
    ignoresBlockers: 0,
    inflicts: { kind: 'wither', duration: 14, magnitude: 0.4, stat: 'bl' },
  }),
  technique({
    id: 'venom-tackle',
    name: 'Venom Tackle',
    kind: 'tackle',
    hpCost: 12,
    description: 'Poisons the carrier as the ball is won',
    power: 3,
    ignoresBlockers: 0,
    inflicts: { kind: 'poison', duration: 10, magnitude: 3 },
  }),
  technique({
    id: 'wither-tackle',
    name: 'Wither Tackle',
    kind: 'tackle',
    hpCost: 10,
    description: 'Saps the endurance of whoever loses the ball',
    power: 3,
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
