import { describe, expect, it } from 'vitest'
import {
  BLOCK_FACTOR,
  PASS_DECAY_PER_UNIT,
  ROLL_HEADROOM,
  SHOT_DECAY_PER_UNIT,
  contestReduction,
  keeperSaves,
  passPower,
  rollStat,
  shotPower,
  tackleTotal,
} from './formulas'
import { Rng } from '../rng'

describe('rollStat', () => {
  it('never returns less than the stat itself', () => {
    const rng = new Rng(1)
    for (let i = 0; i < 2000; i++) {
      expect(rollStat(10, rng)).toBeGreaterThanOrEqual(10)
    }
  })

  it('never exceeds the stat plus its headroom', () => {
    const rng = new Rng(2)
    const ceiling = 10 + Math.floor(10 * ROLL_HEADROOM)
    for (let i = 0; i < 2000; i++) {
      expect(rollStat(10, rng)).toBeLessThanOrEqual(ceiling)
    }
  })

  it('reaches both ends of its range', () => {
    const rng = new Rng(3)
    const seen = new Set<number>()
    for (let i = 0; i < 5000; i++) seen.add(rollStat(10, rng))
    expect(Math.min(...seen)).toBe(10)
    expect(Math.max(...seen)).toBe(15)
  })

  it('treats a zero or negative stat as nothing', () => {
    const rng = new Rng(4)
    expect(rollStat(0, rng)).toBe(0)
    expect(rollStat(-5, rng)).toBe(0)
  })

  it('lets a weaker player occasionally out-roll a stronger one', () => {
    const rng = new Rng(5)
    let upsets = 0
    for (let i = 0; i < 2000; i++) {
      if (rollStat(10, rng) > rollStat(12, rng)) upsets++
    }
    // Not common, but it must be possible — that is the point of rolling.
    expect(upsets).toBeGreaterThan(0)
    expect(upsets / 2000).toBeLessThan(0.4)
  })
})

describe('tackleTotal', () => {
  it('is zero with nobody engaging', () => {
    expect(tackleTotal([], new Rng(1))).toBe(0)
  })

  it('grows with each additional defender', () => {
    const one = tackleTotal([8], new Rng(9))
    const three = tackleTotal([8, 8, 8], new Rng(9))
    expect(three).toBeGreaterThan(one)
  })

  it('is at least the sum of the raw stats', () => {
    const rng = new Rng(11)
    for (let i = 0; i < 500; i++) {
      expect(tackleTotal([5, 7, 9], rng)).toBeGreaterThanOrEqual(21)
    }
  })
})

describe('pass and shot power', () => {
  it('loses power with distance', () => {
    const near = passPower(10, 0, new Rng(7))
    const far = passPower(10, 40, new Rng(7))
    expect(far).toBeLessThan(near)
    expect(near - far).toBeCloseTo(40 * PASS_DECAY_PER_UNIT, 6)
  })

  it('decays a shot faster than a pass over the same distance', () => {
    expect(SHOT_DECAY_PER_UNIT).toBeGreaterThan(PASS_DECAY_PER_UNIT)
    const pass = passPower(20, 30, new Rng(8))
    const shot = shotPower(20, 30, new Rng(8))
    expect(shot).toBeLessThan(pass)
  })

  it('never goes negative, however far the attempt', () => {
    const rng = new Rng(13)
    expect(passPower(4, 500, rng)).toBe(0)
    expect(shotPower(4, 500, rng)).toBe(0)
  })
})

describe('contesting and saving', () => {
  it('takes a fraction of a blocker s BL, not all of it', () => {
    const rng = new Rng(17)
    for (let i = 0; i < 500; i++) {
      const reduction = contestReduction(10, rng)
      expect(reduction).toBeGreaterThan(0)
      expect(reduction).toBeLessThan(10)
      expect(reduction).toBeLessThanOrEqual(15 * BLOCK_FACTOR)
    }
  })

  it('has the keeper claim anything they match or beat', () => {
    // A keeper rolling at least 12 against a shot of exactly 12 must save.
    expect(keeperSaves(12, 12, new Rng(1))).toBe(true)
    expect(keeperSaves(12, 20, new Rng(1))).toBe(true)
  })

  it('cannot save a shot beyond its reach', () => {
    const rng = new Rng(19)
    // CA 10 rolls at most 15, so a shot of 16 always beats it.
    for (let i = 0; i < 500; i++) {
      expect(keeperSaves(16, 10, rng)).toBe(false)
    }
  })

  it('is contested rather than certain in the overlap', () => {
    const rng = new Rng(23)
    let saves = 0
    for (let i = 0; i < 1000; i++) if (keeperSaves(13, 10, rng)) saves++
    expect(saves).toBeGreaterThan(0)
    expect(saves).toBeLessThan(1000)
  })
})
