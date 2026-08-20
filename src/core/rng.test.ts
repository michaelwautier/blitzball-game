import { describe, expect, it } from 'vitest'
import { Rng } from './rng'

const draw = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.next())

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    expect(draw(new Rng(1234), 10)).toEqual(draw(new Rng(1234), 10))
  })

  it('produces different streams for different seeds', () => {
    expect(draw(new Rng(1), 10)).not.toEqual(draw(new Rng(2), 10))
  })

  it('derives a stable seed from a string', () => {
    expect(draw(Rng.fromString('besaid'), 5)).toEqual(draw(Rng.fromString('besaid'), 5))
    expect(draw(Rng.fromString('besaid'), 5)).not.toEqual(draw(Rng.fromString('luca'), 5))
  })

  it('keeps next() within [0, 1)', () => {
    const rng = new Rng(99)
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('keeps int() within the inclusive bounds and hits both ends', () => {
    const rng = new Rng(7)
    const seen = new Set<number>()
    for (let i = 0; i < 10_000; i++) {
      const v = rng.int(1, 6)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
      seen.add(v)
    }
    expect(seen.size).toBe(6)
  })

  it('int() with equal bounds returns that value', () => {
    const rng = new Rng(3)
    expect(rng.int(4, 4)).toBe(4)
  })

  it('distributes chance() roughly around p', () => {
    const rng = new Rng(2024)
    let hits = 0
    for (let i = 0; i < 20_000; i++) if (rng.chance(0.25)) hits++
    expect(hits / 20_000).toBeCloseTo(0.25, 1)
  })

  it('restores a saved state exactly', () => {
    const rng = new Rng(555)
    draw(rng, 5)
    const snapshot = rng.save()
    const expected = draw(rng, 5)

    rng.restore(snapshot)
    expect(draw(rng, 5)).toEqual(expected)
  })

  it('clones without sharing state', () => {
    const rng = new Rng(42)
    const clone = rng.clone()
    expect(draw(clone, 5)).toEqual(draw(rng, 5))
  })

  it('throws when picking from an empty array', () => {
    expect(() => new Rng(1).pick([])).toThrow()
  })
})
