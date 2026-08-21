import { describe, expect, it } from 'vitest'
import {
  CATCH_FLOOR,
  CATCH_ROLL_MAX,
  CATCH_ROLL_MIN,
  PASS_DECAY_PER_UNIT,
  ROLL_MAX,
  ROLL_MIN,
  SHOT_DECAY_PER_UNIT,
  catchStrength,
  expectedCatch,
  passDecay,
  passRange,
  rollBounds,
  rollCatch,
  rollStat,
  shotDecay,
  tackleTotal,
} from './formulas'
import { Rng } from '../rng'

describe('rolling a contested stat', () => {
  it('stays between half and one and a half times the stat', () => {
    const rng = new Rng(1)
    const { min, max } = rollBounds(10)
    for (let i = 0; i < 5000; i++) {
      const roll = rollStat(10, rng)
      expect(roll).toBeGreaterThanOrEqual(min)
      expect(roll).toBeLessThanOrEqual(max)
    }
  })

  it('reports bounds that match what it actually rolls', () => {
    const rng = new Rng(2)
    const seen = new Set<number>()
    for (let i = 0; i < 20_000; i++) seen.add(rollStat(10, rng))

    const { min, max } = rollBounds(10)
    expect(Math.min(...seen)).toBe(min)
    expect(Math.max(...seen)).toBe(max)
    expect(min).toBe(Math.round(10 * ROLL_MIN))
    expect(max).toBe(Math.round(10 * ROLL_MAX))
  })

  it('averages out near the stat itself', () => {
    const rng = new Rng(3)
    let total = 0
    for (let i = 0; i < 20_000; i++) total += rollStat(12, rng)
    expect(total / 20_000).toBeCloseTo(12, 0)
  })

  it('treats a zero or negative stat as nothing', () => {
    const rng = new Rng(4)
    expect(rollStat(0, rng)).toBe(0)
    expect(rollStat(-5, rng)).toBe(0)
    expect(rollBounds(0)).toEqual({ min: 0, max: 0 })
  })

  it('never returns a negative roll', () => {
    const rng = new Rng(5)
    for (let i = 0; i < 2000; i++) expect(rollStat(1, rng)).toBeGreaterThanOrEqual(0)
  })

  it('lets a weak defender sometimes out-roll a strong one', () => {
    const rng = new Rng(6)
    let upsets = 0
    for (let i = 0; i < 5000; i++) {
      if (rollStat(6, rng) > rollStat(9, rng)) upsets++
    }
    // Uncommon, but the whole texture of the game depends on it being possible.
    expect(upsets).toBeGreaterThan(0)
    expect(upsets / 5000).toBeLessThan(0.4)
  })

  it('can miss badly and can land heavily', () => {
    const rng = new Rng(7)
    const rolls = Array.from({ length: 5000 }, () => rollStat(10, rng))
    // Half strength is a real outcome, and so is half again.
    expect(rolls.some((r) => r <= 6)).toBe(true)
    expect(rolls.some((r) => r >= 14)).toBe(true)
  })
})

describe('combined tackles', () => {
  it('is nothing with nobody engaging', () => {
    expect(tackleTotal([], new Rng(1))).toBe(0)
  })

  it('grows with each additional defender', () => {
    expect(tackleTotal([8, 8, 8], new Rng(9))).toBeGreaterThan(tackleTotal([8], new Rng(9)))
  })

  it('stays inside the sum of the individual bounds', () => {
    const rng = new Rng(11)
    const stats = [5, 7, 9]
    const min = stats.reduce((t, s) => t + rollBounds(s).min, 0)
    const max = stats.reduce((t, s) => t + rollBounds(s).max, 0)

    for (let i = 0; i < 2000; i++) {
      const total = tackleTotal(stats, rng)
      expect(total).toBeGreaterThanOrEqual(min)
      expect(total).toBeLessThanOrEqual(max)
    }
  })
})

describe('distance', () => {
  it('costs a pass power in proportion to how far it goes', () => {
    expect(passDecay(0)).toBe(0)
    expect(passDecay(40)).toBeCloseTo(40 * PASS_DECAY_PER_UNIT, 9)
    expect(passDecay(80)).toBeCloseTo(passDecay(40) * 2, 9)
  })

  it('costs a shot more than a pass over the same distance', () => {
    expect(SHOT_DECAY_PER_UNIT).toBeGreaterThan(PASS_DECAY_PER_UNIT)
    expect(shotDecay(30)).toBeGreaterThan(passDecay(30))
  })

  it('is deterministic, unlike the contests', () => {
    // Distance is the one part of a throw that is not a gamble.
    expect(passDecay(17)).toBe(passDecay(17))
  })
})

describe("a keeper's catch", () => {
  it('gives every keeper a floor to stand on', () => {
    // Someone with no catching at all is still in front of the ring.
    expect(catchStrength(0)).toBe(CATCH_FLOOR)
    expect(catchStrength(-5)).toBe(CATCH_FLOOR)
  })

  it('still ranks keepers by their catching', () => {
    const [keepa, nizarut, raudy, nimrook] = [5, 6, 8, 18].map(catchStrength)
    expect(keepa).toBeLessThan(nizarut!)
    expect(nizarut).toBeLessThan(raudy!)
    expect(raudy).toBeLessThan(nimrook!)
  })

  it('narrows the gulf between the best and worst without closing it', () => {
    // Raw, Nimrook catches at 3.6 times Keepa, which decided fixtures outright
    // before a ball was thrown. The floor brings that inside a factor of three.
    const raw = 18 / 5
    const withFloor = catchStrength(18) / catchStrength(5)
    expect(withFloor).toBeLessThan(raw)
    expect(withFloor).toBeGreaterThan(1.5)
  })

  it('swings wider than an ordinary contested roll', () => {
    expect(CATCH_ROLL_MIN).toBeLessThan(ROLL_MIN)
    expect(CATCH_ROLL_MAX).toBeGreaterThan(ROLL_MAX)
  })

  it('rolls inside its own band', () => {
    const rng = new Rng(7)
    const strength = catchStrength(9)
    for (let i = 0; i < 5000; i++) {
      const roll = rollCatch(9, rng)
      expect(roll).toBeGreaterThanOrEqual(Math.round(strength * CATCH_ROLL_MIN))
      expect(roll).toBeLessThanOrEqual(Math.round(strength * CATCH_ROLL_MAX))
    }
  })

  it('can be beaten, however good the keeper', () => {
    const rng = new Rng(11)
    const rolls = Array.from({ length: 2000 }, () => rollCatch(18, rng))
    // Nimrook, the best keeper in the game, still has moments worse than a
    // shot arriving with eight power. Without this the fixture is decided.
    expect(Math.min(...rolls)).toBeLessThan(8)
  })

  it('saves something, however poor the keeper', () => {
    const rng = new Rng(13)
    const rolls = Array.from({ length: 2000 }, () => rollCatch(5, rng))
    expect(Math.max(...rolls)).toBeGreaterThan(8)
  })

  it('expects the middle of its own band, not the bare stat', () => {
    // What the AI shoots against. Reading the stat directly is what had
    // shooters decline to shoot at all for whole matches.
    expect(expectedCatch(9)).toBeCloseTo(catchStrength(9) * 1.1)
    expect(expectedCatch(9)).not.toBeCloseTo(9)
  })

  it('averages out near the middle of the band over many rolls', () => {
    const rng = new Rng(17)
    const rolls = Array.from({ length: 20000 }, () => rollCatch(9, rng))
    const mean = rolls.reduce((sum, r) => sum + r, 0) / rolls.length
    expect(mean).toBeCloseTo(expectedCatch(9), 0)
  })
})

describe('passing range', () => {
  it('is exactly the distance the power runs out over', () => {
    // The inverse of the decay, so the two can never disagree about where a
    // pass dies: at `passRange(p)` there is precisely nothing left.
    expect(passDecay(passRange(10))).toBeCloseTo(10)
    expect(passRange(0)).toBe(0)
  })

  it('is nothing at all for a throw with no power behind it', () => {
    // A pass the defence has already eaten cannot travel a negative distance.
    expect(passRange(-5)).toBe(0)
  })
})
