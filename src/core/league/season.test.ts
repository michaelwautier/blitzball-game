import { describe, expect, it } from 'vitest'
import {
  createSeason,
  currentRound,
  fixtureSeed,
  isPlayed,
  isSeasonOver,
  nextUserFixture,
  recordResult,
  seasonTable,
  simulateRestOfSeason,
  simulateRound,
  totalRounds,
} from './season'
import { involves } from './fixtures'
import { TEAMS } from '../../data/teams'

const IDS = TEAMS.map((team) => team.id)
const USER = 'aurochs'
const newSeason = (seed = 'season') => createSeason(IDS, USER, seed)

describe('starting a season', () => {
  it('schedules every side against every other, twice', () => {
    const season = newSeason()
    expect(season.fixtures).toHaveLength(IDS.length * (IDS.length - 1))
    expect(season.results).toEqual([])
  })

  it('refuses a manager who is not in the league', () => {
    expect(() => createSeason(IDS, 'zanarkand', 'x')).toThrow(/zanarkand/)
  })

  it('starts on round one with nothing played', () => {
    const season = newSeason()
    expect(currentRound(season)).toBe(1)
    expect(isSeasonOver(season)).toBe(false)
    expect(seasonTable(season).every((row) => row.played === 0)).toBe(true)
  })

  it('gives the user a fixture to play', () => {
    const fixture = nextUserFixture(newSeason())
    expect(fixture).toBeDefined()
    expect(involves(fixture!, USER)).toBe(true)
    expect(fixture!.round).toBe(1)
  })
})

describe('recording a result', () => {
  it('puts it in the table', () => {
    const season = newSeason()
    const fixture = nextUserFixture(season)!

    expect(recordResult(season, fixture, 3, 1)).toBe(true)
    const table = seasonTable(season)
    const winner = table.find((row) => row.teamId === fixture.home)!
    expect(winner.points).toBe(3)
  })

  it('refuses to record the same fixture twice', () => {
    // A stray click or a reloaded page must not quietly double a scoreline.
    const season = newSeason()
    const fixture = nextUserFixture(season)!

    expect(recordResult(season, fixture, 3, 1)).toBe(true)
    expect(recordResult(season, fixture, 9, 9)).toBe(false)
    expect(season.results).toHaveLength(1)
  })

  it('refuses a fixture that is not in this season', () => {
    const season = newSeason()
    const stranger = { round: 1, home: 'aurochs', away: 'goers' }
    expect(recordResult(season, stranger, 1, 0)).toBe(false)
  })

  it('moves the user on to their next fixture', () => {
    const season = newSeason()
    const first = nextUserFixture(season)!
    recordResult(season, first, 1, 0)

    const second = nextUserFixture(season)!
    expect(second).not.toBe(first)
    expect(involves(second, USER)).toBe(true)
  })
})

describe('the rest of the round', () => {
  it('plays out the fixtures the user is not in', () => {
    const season = newSeason()
    const played = simulateRound(season, 1)

    // Six sides, three fixtures a round, one of them the user's.
    expect(played).toBe(2)
    for (const fixture of season.fixtures.filter((f) => f.round === 1)) {
      expect(isPlayed(season, fixture)).toBe(!involves(fixture, USER))
    }
  })

  it('leaves the user to play their own', () => {
    const season = newSeason()
    simulateRound(season, 1)
    expect(nextUserFixture(season)!.round).toBe(1)
  })

  it('does not replay a round it has already resolved', () => {
    const season = newSeason()
    expect(simulateRound(season, 1)).toBe(2)
    expect(simulateRound(season, 1)).toBe(0)
    expect(season.results).toHaveLength(2)
  })

  it('holds the round until the user has played theirs', () => {
    const season = newSeason()
    simulateRound(season, 1)
    expect(currentRound(season)).toBe(1)

    recordResult(season, nextUserFixture(season)!, 1, 1)
    expect(currentRound(season)).toBe(2)
  })

  it('produces scorelines from the real engine, not from thin air', () => {
    const season = newSeason()
    simulateRestOfSeason(season)
    // Twenty-four fixtures without the user's ten. Goals are scored in them.
    const goals = season.results.reduce((sum, r) => sum + r.home + r.away, 0)
    expect(season.results).toHaveLength(20)
    expect(goals).toBeGreaterThan(0)
  })
})

describe('finishing a season', () => {
  /** Play the whole thing out, the user's fixtures included. */
  const playOut = (seed: string) => {
    const season = createSeason(IDS, USER, seed)
    for (let round = 1; round <= totalRounds(season); round++) {
      simulateRound(season, round)
      const fixture = nextUserFixture(season)
      if (fixture?.round === round) recordResult(season, fixture, 1, 1)
    }
    return season
  }

  it('knows when there is nothing left to play', () => {
    const season = playOut('finish')
    expect(isSeasonOver(season)).toBe(true)
    expect(currentRound(season)).toBe(totalRounds(season) + 1)
  })

  it('has every side playing the same number of matches', () => {
    const table = seasonTable(playOut('even'))
    const played = table.map((row) => row.played)
    expect(new Set(played).size, `uneven: ${played.join(', ')}`).toBe(1)
    expect(played[0]).toBe((IDS.length - 1) * 2)
  })

  it('awards points that add up to what was played', () => {
    const season = playOut('points')
    const table = seasonTable(season)
    const awarded = table.reduce((sum, row) => sum + row.points, 0)
    // Three per fixture, less one for each draw, since a draw pays two in total.
    const draws = season.results.filter((r) => r.home === r.away).length
    expect(awarded).toBe(season.results.length * 3 - draws)
  })
})

describe('replaying a season', () => {
  /**
   * The property a save file rests on.
   *
   * A fixture's scoreline must depend only on the season's seed and the fixture
   * itself — never on when it happened to be resolved. Otherwise reloading a
   * saved season and continuing it quietly rewrites results the user has
   * already seen.
   */
  it('gives a fixture the same scoreline whenever it is resolved', () => {
    // Rounds three and one, against one and three: enough to prove the result
    // does not depend on resolution order, without simulating a whole season.
    const forwards = newSeason('replay')
    simulateRound(forwards, 1)
    simulateRound(forwards, 3)

    const backwards = newSeason('replay')
    simulateRound(backwards, 3)
    simulateRound(backwards, 1)

    for (const result of forwards.results) {
      const other = backwards.results.find(
        (r) => r.fixture.round === result.fixture.round && r.fixture.home === result.fixture.home,
      )
      expect(other, `${result.fixture.home} v ${result.fixture.away} went missing`).toBeDefined()
      expect([other!.home, other!.away]).toEqual([result.home, result.away])
    }
    expect(forwards.results.length).toBe(4)
  })

  it('gives different seasons different results', () => {
    const line = (seed: string) => {
      const season = newSeason(seed)
      // Three rounds is six simulated fixtures — plenty to diverge on.
      for (let round = 1; round <= 3; round++) simulateRound(season, round)
      return season.results.map((r) => `${r.home}-${r.away}`).join(',')
    }
    expect(line('seed-one')).not.toBe(line('seed-two'))
  })

  it('seeds each fixture distinctly', () => {
    const season = newSeason()
    const seeds = season.fixtures.map((fixture) => fixtureSeed(season, fixture))
    expect(new Set(seeds).size).toBe(seeds.length)
  })
})
