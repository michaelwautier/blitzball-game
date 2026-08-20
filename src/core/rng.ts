/**
 * Seedable, serializable PRNG (mulberry32).
 *
 * The whole simulation draws randomness from here so that a match is fully
 * reproducible from its seed: same seed + same inputs => same match. That makes
 * encounter math testable and lets league fixtures be re-simulated identically.
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed | 0
  }

  static fromString(seed: string): Rng {
    // FNV-1a
    let h = 0x811c9dc5
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    return new Rng(h)
  }

  /** Float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  /** True with probability `p` (0..1). */
  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array')
    return items[this.int(0, items.length - 1)]!
  }

  /** Snapshot of internal state, for save games and replays. */
  save(): number {
    return this.state
  }

  restore(state: number): void {
    this.state = state | 0
  }

  /** Independent generator continuing from the current state. */
  clone(): Rng {
    return new Rng(this.state)
  }
}
