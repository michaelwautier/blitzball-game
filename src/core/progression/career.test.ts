import { describe, expect, it } from 'vitest'
import {
  MAX_LEVEL,
  awardExperience,
  createCareer,
  currentStats,
  expForNextLevel,
  GROWABLE,
} from './career'
import { findPlayer, BESAID_AUROCHS, TEAMS } from '../../data/teams'

const tidus = findPlayer(BESAID_AUROCHS, 'tidus')
const keepa = findPlayer(BESAID_AUROCHS, 'keepa')

describe('growth curves', () => {
  it('gives every player a curve for every stat', () => {
    for (const team of TEAMS) {
      for (const player of team.roster) {
        for (const key of GROWABLE) {
          // Several players never gain a point of speed in the real tables, so
          // a flat curve is data rather than a gap in it.
          expect(player.growth[key], `${player.name}.${key}`).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('gives every player something they actually improve at', () => {
    for (const team of TEAMS) {
      for (const player of team.roster) {
        const best = Math.max(...GROWABLE.filter((k) => k !== 'hp').map((k) => player.growth[k]))
        expect(best, `${player.name} improves at nothing`).toBeGreaterThan(0.1)
      }
    }
  })

  it('shapes each player towards what they are', () => {
    // A curve is a character sketch: these are the claims the data makes.
    expect(tidus.growth.sh).toBeGreaterThan(tidus.growth.bl)
    expect(keepa.growth.ca).toBeGreaterThan(keepa.growth.sh)
    expect(findPlayer(BESAID_AUROCHS, 'jassu').growth.bl).toBeGreaterThan(
      findPlayer(BESAID_AUROCHS, 'jassu').growth.sh,
    )
  })

  it('has the specialist grow faster at their speciality', () => {
    // Tidus becomes the shooter; Datto stays a quick squad player.
    expect(tidus.growth.sh).toBeGreaterThan(findPlayer(BESAID_AUROCHS, 'datto').growth.sh)
    // Datto is the one who actually gets quicker.
    expect(findPlayer(BESAID_AUROCHS, 'datto').growth.sp).toBeGreaterThan(tidus.growth.sp)
  })
})

describe('a new career', () => {
  it('starts at level one with nothing banked', () => {
    const career = createCareer('home:tidus')
    expect(career.level).toBe(1)
    expect(career.exp).toBe(0)
  })

  it('leaves a player on their base stats', () => {
    expect(currentStats(tidus, createCareer('home:tidus'))).toEqual(tidus.stats)
  })

  it('falls back to base stats when there is no career at all', () => {
    expect(currentStats(tidus, undefined)).toEqual(tidus.stats)
  })
})

describe('earning experience', () => {
  it('banks experience without levelling when it is not enough', () => {
    const career = createCareer('home:tidus')
    const result = awardExperience(tidus, career, expForNextLevel(1) - 1)

    expect(career.level).toBe(1)
    expect(career.exp).toBe(expForNextLevel(1) - 1)
    expect(result.levelUps).toEqual([])
  })

  it('levels up on exactly the threshold', () => {
    const career = createCareer('home:tidus')
    awardExperience(tidus, career, expForNextLevel(1))
    expect(career.level).toBe(2)
    expect(career.exp).toBe(0)
  })

  it('carries the remainder towards the next level', () => {
    const career = createCareer('home:tidus')
    awardExperience(tidus, career, expForNextLevel(1) + 7)
    expect(career.level).toBe(2)
    expect(career.exp).toBe(7)
  })

  it('levels more than once from a single big haul', () => {
    const career = createCareer('home:tidus')
    const enough = expForNextLevel(1) + expForNextLevel(2) + expForNextLevel(3)
    const result = awardExperience(tidus, career, enough)

    expect(career.level).toBe(4)
    expect(result.levelUps).toHaveLength(3)
    expect(result.levelUps.map((l) => l.level)).toEqual([2, 3, 4])
  })

  it('needs more experience for each successive level', () => {
    expect(expForNextLevel(2)).toBeGreaterThan(expForNextLevel(1))
    expect(expForNextLevel(10)).toBeGreaterThan(expForNextLevel(9))
  })

  it('ignores a negative award rather than draining a career', () => {
    const career = createCareer('home:tidus')
    career.exp = 10
    awardExperience(tidus, career, -50)
    expect(career.exp).toBe(10)
  })

  it('reports the level either side of the award', () => {
    const career = createCareer('home:tidus')
    const result = awardExperience(tidus, career, expForNextLevel(1))
    expect(result.levelBefore).toBe(1)
    expect(result.levelAfter).toBe(2)
    expect(result.name).toBe('Tidus')
  })
})

describe('what levelling buys', () => {
  it('raises stats along the player s own curve', () => {
    const career = createCareer('home:tidus')
    // Ten levels is enough for even the slowest curve to show.
    for (let i = 0; i < 10; i++) awardExperience(tidus, career, expForNextLevel(career.level))

    const now = currentStats(tidus, career)
    expect(now.sh).toBeGreaterThan(tidus.stats.sh)
    expect(now.hp).toBeGreaterThan(tidus.stats.hp)
    // Blocking is his weakest curve, so it must lag his shooting.
    expect(now.sh - tidus.stats.sh).toBeGreaterThan(now.bl - tidus.stats.bl)
  })

  it('keeps fractional growth instead of rounding it away', () => {
    // Wither-free arithmetic: a 0.5 curve must yield a point every two levels,
    // which rounding each level down to zero would never produce.
    const career = createCareer('home:tidus')
    awardExperience(tidus, career, expForNextLevel(1))
    awardExperience(tidus, career, expForNextLevel(2))

    expect(career.gains.sp).toBeCloseTo(tidus.growth.sp * 2, 6)
    expect(currentStats(tidus, career).sp).toBe(tidus.stats.sp + Math.floor(tidus.growth.sp * 2))
  })

  it('reports only the stats that actually moved', () => {
    const career = createCareer('home:keepa')
    const result = awardExperience(keepa, career, expForNextLevel(1))

    for (const [key, value] of Object.entries(result.levelUps[0]!.increases)) {
      expect(value, key).toBeGreaterThan(0)
    }
  })

  it('totals the gains across a multi-level award', () => {
    const career = createCareer('home:tidus')
    const enough = expForNextLevel(1) + expForNextLevel(2) + expForNextLevel(3)
    const result = awardExperience(tidus, career, enough)

    for (const key of GROWABLE) {
      const perLevel = result.levelUps.reduce((sum, l) => sum + (l.increases[key] ?? 0), 0)
      expect(result.totalIncreases[key] ?? 0, key).toBe(perLevel)
    }
  })

  it('grows two players differently from the same experience', () => {
    const tidusCareer = createCareer('home:tidus')
    const keepaCareer = createCareer('home:keepa')
    const exp = 2000

    awardExperience(tidus, tidusCareer, exp)
    awardExperience(keepa, keepaCareer, exp)

    const grownTidus = currentStats(tidus, tidusCareer)
    const grownKeepa = currentStats(keepa, keepaCareer)

    expect(grownTidus.sh - tidus.stats.sh).toBeGreaterThan(grownKeepa.sh - keepa.stats.sh)
    expect(grownKeepa.ca - keepa.stats.ca).toBeGreaterThan(grownTidus.ca - tidus.stats.ca)
  })
})

describe('the level cap', () => {
  it('stops at the cap however much is banked', () => {
    const career = createCareer('home:tidus')
    awardExperience(tidus, career, 10_000_000)
    expect(career.level).toBe(MAX_LEVEL)
  })

  it('banks nothing further once capped', () => {
    const career = createCareer('home:tidus')
    awardExperience(tidus, career, 10_000_000)
    awardExperience(tidus, career, 500)
    expect(career.exp).toBe(0)
    expect(career.level).toBe(MAX_LEVEL)
  })
})
