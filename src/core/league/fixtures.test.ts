import { describe, expect, it } from 'vitest'
import { LEGS, fixturesInRound, involves, roundRobin, roundsIn } from './fixtures'
import { TEAMS } from '../../data/teams'

const SIX = TEAMS.map((team) => team.id)
const key = (a: string, b: string) => [a, b].sort().join(' v ')

describe('the fixture list', () => {
  const fixtures = roundRobin(SIX)

  it('pairs every side with every other, once per leg', () => {
    const meetings = new Map<string, number>()
    for (const fixture of fixtures) {
      const pair = key(fixture.home, fixture.away)
      meetings.set(pair, (meetings.get(pair) ?? 0) + 1)
    }

    const pairs = (SIX.length * (SIX.length - 1)) / 2
    expect(meetings.size, 'some pair never meet').toBe(pairs)
    for (const [pair, times] of meetings) {
      expect(times, `${pair} met ${times} times`).toBe(LEGS)
    }
  })

  it('gives each pair one fixture at each end of the pool', () => {
    for (const fixture of fixtures) {
      const reverse = fixtures.filter(
        (other) => other.home === fixture.away && other.away === fixture.home,
      )
      expect(reverse, `${fixture.home} never visit ${fixture.away}`).toHaveLength(1)
    }
  })

  it('runs to five rounds a leg', () => {
    expect(roundsIn(fixtures)).toBe((SIX.length - 1) * LEGS)
  })

  it('has every side playing exactly once a round', () => {
    for (let round = 1; round <= roundsIn(fixtures); round++) {
      const playing = fixturesInRound(fixtures, round).flatMap((f) => [f.home, f.away])
      expect(new Set(playing).size, `round ${round} has a side playing twice`).toBe(
        playing.length,
      )
      expect(playing).toHaveLength(SIX.length)
    }
  })

  it('never has a side play itself', () => {
    expect(fixtures.every((fixture) => fixture.home !== fixture.away)).toBe(true)
  })

  it('gives every side an even split of home and away', () => {
    for (const teamId of SIX) {
      const home = fixtures.filter((f) => f.home === teamId).length
      const away = fixtures.filter((f) => f.away === teamId).length
      expect(home, `${teamId} plays ${home} at home and ${away} away`).toBe(away)
    }
  })

  it('does not send a side away for a whole leg', () => {
    // The alternation exists for this. Without it the schedule is still valid
    // and still deeply unfair to whoever draws the short straw.
    const roundsPerLeg = SIX.length - 1
    for (const teamId of SIX) {
      const firstLeg = fixtures.filter((f) => f.round <= roundsPerLeg && involves(f, teamId))
      expect(firstLeg.some((f) => f.home === teamId), `${teamId} never at home`).toBe(true)
      expect(firstLeg.some((f) => f.away === teamId), `${teamId} never away`).toBe(true)
    }
  })
})

describe('leagues of awkward sizes', () => {
  it('handles an odd number of teams by giving byes', () => {
    const fixtures = roundRobin(['a', 'b', 'c'], 1)
    // Three teams still meet each other once: a-b, a-c, b-c.
    expect(fixtures).toHaveLength(3)
    expect(new Set(fixtures.map((f) => key(f.home, f.away))).size).toBe(3)
  })

  it('gives an odd league a round each for the byes, rather than dropping fixtures', () => {
    const fixtures = roundRobin(['a', 'b', 'c'], 1)
    expect(roundsIn(fixtures)).toBe(3)
    for (let round = 1; round <= 3; round++) {
      expect(fixturesInRound(fixtures, round)).toHaveLength(1)
    }
  })

  it('has nothing to schedule for one side or none', () => {
    expect(roundRobin(['a'])).toEqual([])
    expect(roundRobin([])).toEqual([])
  })

  it('schedules a single leg when asked for one', () => {
    expect(roundRobin(SIX, 1)).toHaveLength((SIX.length * (SIX.length - 1)) / 2)
  })
})

describe('reading a fixture', () => {
  it('knows which sides are in it', () => {
    const fixture = { round: 1, home: 'aurochs', away: 'goers' }
    expect(involves(fixture, 'aurochs')).toBe(true)
    expect(involves(fixture, 'goers')).toBe(true)
    expect(involves(fixture, 'psyches')).toBe(false)
  })

  it('counts no rounds in an empty schedule', () => {
    expect(roundsIn([])).toBe(0)
  })
})
