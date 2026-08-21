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
import type { Season } from './season'
import { TEAMS, findTeam } from '../../data/teams'
import { Squad } from '../progression/squad'
import { simulateMatch } from './simulate'

const IDS = TEAMS.map((team) => team.id)

/**
 * Fixtures in a round that are not the user's, derived rather than counted by
 * hand — so adding a side to the league does not quietly turn the assertions
 * below into assertions about nothing.
 */
const othersPerRound = (season: Season, round = 1): number =>
  season.fixtures.filter((f) => f.round === round && !involves(f, USER)).length
const USER = 'aurochs'
const newSeason = (seed = 'season') => createSeason(IDS, USER, seed)

/**
 * A three-team league, for the tests that have to play a season out.
 *
 * Simulating a match is the real engine at full fidelity, so a six-team season
 * is forty of them and takes long enough to time out on a slower machine. The
 * structure being checked — every side playing the same number of matches,
 * points adding up, the season ending — holds at any size, and the six-team
 * schedule itself is covered in `fixtures.test.ts`.
 */
const SMALL = ['aurochs', 'goers', 'beasts']
const smallSeason = (seed: string) => createSeason(SMALL, USER, seed)

/** Long enough for a real simulation on a slow CI runner. */
const SIMULATED = 120_000

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
    expect(recordResult(season, { round: 1, home: 'aurochs', away: 'zanarkand' }, 1, 0)).toBe(false)
    // Right teams, wrong round: still not a fixture anyone scheduled.
    const real = season.fixtures[0]!
    expect(recordResult(season, { ...real, round: 99 }, 1, 0)).toBe(false)
    expect(season.results).toEqual([])
  })

  it('recognises a fixture by what it is, not by which object it is', () => {
    // A season restored from a save file has freshly parsed fixtures. Comparing
    // by identity worked right up until there was a save file.
    const season = newSeason()
    const fixture = nextUserFixture(season)!

    expect(recordResult(season, { ...fixture }, 2, 0)).toBe(true)
    expect(isPlayed(season, fixture)).toBe(true)
    expect(nextUserFixture(season)).not.toEqual(fixture)
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

    // Every fixture of the round bar the user's own. Read off the fixture list
    // rather than written down, so adding a side to the league does not quietly
    // turn this into an assertion about nothing.
    expect(played).toBe(othersPerRound(season))
    expect(played).toBeGreaterThan(0)
    for (const fixture of season.fixtures.filter((f) => f.round === 1)) {
      expect(isPlayed(season, fixture)).toBe(!involves(fixture, USER))
    }
  }, SIMULATED)

  it('leaves the user to play their own', () => {
    const season = newSeason()
    simulateRound(season, 1)
    expect(nextUserFixture(season)!.round).toBe(1)
  }, SIMULATED)

  it('does not replay a round it has already resolved', () => {
    const season = newSeason()
    const others = othersPerRound(season)

    expect(simulateRound(season, 1)).toBe(others)
    expect(simulateRound(season, 1)).toBe(0)
    expect(season.results).toHaveLength(others)
  }, SIMULATED)

  it('holds the round until the user has played theirs', () => {
    const season = newSeason()
    simulateRound(season, 1)
    expect(currentRound(season)).toBe(1)

    recordResult(season, nextUserFixture(season)!, 1, 1)
    expect(currentRound(season)).toBe(2)
  }, SIMULATED)

  it('produces scorelines from the real engine, not from thin air', () => {
    const season = smallSeason('engine')
    simulateRestOfSeason(season)
    // Six fixtures, four of them without the user. Goals are scored in them.
    expect(season.results).toHaveLength(2)
    const goals = season.results.reduce((sum, r) => sum + r.home + r.away, 0)
    expect(goals).toBeGreaterThan(0)
  }, SIMULATED)
})

describe('finishing a season', () => {
  /** Play the whole thing out, the user's fixtures included. */
  const playOut = (seed: string) => {
    const season = smallSeason(seed)
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
  }, SIMULATED)

  it('has every side playing the same number of matches', () => {
    const table = seasonTable(playOut('even'))
    const played = table.map((row) => row.played)
    expect(new Set(played).size, `uneven: ${played.join(', ')}`).toBe(1)
    expect(played[0]).toBe((SMALL.length - 1) * 2)
  }, SIMULATED)

  it('awards points that add up to what was played', () => {
    const season = playOut('points')
    const table = seasonTable(season)
    const awarded = table.reduce((sum, row) => sum + row.points, 0)
    // Three per fixture, less one for each draw, since a draw pays two in total.
    const draws = season.results.filter((r) => r.home === r.away).length
    expect(awarded).toBe(season.results.length * 3 - draws)
  }, SIMULATED)
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
    // Two rounds' worth, whatever a round happens to hold.
    expect(forwards.results.length).toBe(othersPerRound(forwards, 1) + othersPerRound(forwards, 3))
    expect(forwards.results.length).toBeGreaterThan(0)
  }, SIMULATED)

  it('gives different seasons different results', () => {
    const line = (seed: string) => {
      const season = newSeason(seed)
      // Three rounds of simulated fixtures — plenty to diverge on.
      for (let round = 1; round <= 3; round++) simulateRound(season, round)
      return season.results.map((r) => `${r.home}-${r.away}`).join(',')
    }
    expect(line('seed-one')).not.toBe(line('seed-two'))
  }, SIMULATED)

  it('seeds each fixture distinctly', () => {
    const season = newSeason()
    const seeds = season.fixtures.map((fixture) => fixtureSeed(season, fixture))
    expect(new Set(seeds).size).toBe(seeds.length)
  })
})

/**
 * Everybody improves, not only the side being watched.
 *
 * The fixtures the user is not in are played by the same engine, and everyone in
 * them was earning experience that was thrown away the moment the scoreline was
 * recorded. So the user's squad improved every week while the five sides they
 * were chasing stood still for ever — a procession rather than a league, and
 * worse the longer a career went on.
 */
describe('the league improving alongside you', () => {
  /**
   * Four sides rather than ten.
   *
   * These play whole seasons, and a ten-team season is seventy-two simulated
   * matches at five-minute halves — slow here and slower still on CI, where it
   * timed out. Nothing being asserted is about how big the league is.
   */
  const SMALL = IDS.slice(0, 4)

  it('banks what the sides you are not watching earn', () => {
    const season = createSeason(SMALL, 'aurochs', 'levelling')
    const squad = new Squad()

    simulateRound(season, 1, squad)

    // Somebody who was nowhere near the user's fixture has a career now.
    const earned = squad.all()
    expect(earned.length).toBeGreaterThan(0)
    expect(earned.some((career) => !career.playerId.startsWith('aurochs:'))).toBe(true)
  })

  it('leaves them at a higher level after a full season than before it', () => {
    const season = createSeason(SMALL, 'aurochs', 'a-whole-season')
    const squad = new Squad()

    simulateRestOfSeason(season, squad)

    const levelled = squad.all().filter((career) => career.level > 1)
    expect(levelled.length, 'nobody in the league levelled up all season').toBeGreaterThan(0)
  }, SIMULATED)

  it('keeps one career per player however many fixtures they play', () => {
    // Careers are keyed by team and player, not by which end of a fixture they
    // happened to line up at, so a player carries one record all season.
    const season = createSeason(SMALL, 'aurochs', 'one-career')
    const squad = new Squad()

    simulateRestOfSeason(season, squad)

    const ids = squad.all().map((career) => career.playerId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).not.toContain('home:')
  }, SIMULATED)

  it('plays the unwatched fixtures at the levels those sides have reached', () => {
    // Not just banking: the next round has to be played by the improved side,
    // or a league that levels up plays exactly like one that does not.
    const season = createSeason(SMALL, 'aurochs', 'plays-levelled')
    const squad = new Squad()
    simulateRestOfSeason(season, squad)

    const raw = createSeason(IDS, 'aurochs', 'plays-levelled')
    const fixture = raw.fixtures.find((f) => !involves(f, 'aurochs'))!
    const home = findTeam(fixture.home)
    const away = findTeam(fixture.away)

    const withCareers = simulateMatch(home, away, 'compare', squad.lookupFor({ home, away }))
    const without = simulateMatch(home, away, 'compare')

    // Same fixture, same seed; the only difference is who is playing it.
    expect(withCareers).not.toEqual(without)
  }, SIMULATED)
})
