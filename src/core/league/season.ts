import { findTeam } from '../../data/teams'
import { fixtureKey, involves, roundRobin, roundsIn, sameFixture, type Fixture } from './fixtures'
import { simulateMatch } from './simulate'
import { standings, type MatchResult, type TableRow } from './standings'
import type { CareerLookup } from '../match/state'
import type { TeamId } from '../match/types'
import type { TeamDef } from '../../data/types'

/**
 * A season in progress.
 *
 * Deliberately a plain data object with functions over it, rather than a class
 * with behaviour: the whole thing is a fixture list, a pile of results and a
 * seed, which is exactly what a save file needs to hold. Everything else — the
 * table, whose turn it is, whether the season is over — is derived on demand and
 * therefore cannot disagree with the results.
 */
export interface Season {
  /** Every side in the league, by team id. */
  teamIds: readonly string[]
  fixtures: readonly Fixture[]
  results: MatchResult[]
  /** The side the user is managing; their fixtures are played, not simulated. */
  userTeamId: string
  /** Seeds every simulated fixture, so a season replays identically. */
  seed: string
}

export function createSeason(
  teamIds: readonly string[],
  userTeamId: string,
  seed: string,
): Season {
  if (!teamIds.includes(userTeamId)) {
    throw new Error(`${userTeamId} is not in this league`)
  }

  return {
    teamIds: [...teamIds],
    fixtures: roundRobin(teamIds),
    results: [],
    userTeamId,
    seed,
  }
}

/** The table as it stands. */
export function seasonTable(season: Season): TableRow[] {
  return standings(season.teamIds, season.results)
}

/** How many rounds this season runs to. */
export function totalRounds(season: Season): number {
  return roundsIn(season.fixtures)
}

/** Whether this fixture has already been played. */
export function isPlayed(season: Season, fixture: Fixture): boolean {
  return season.results.some((result) => sameFixture(result.fixture, fixture))
}

/**
 * The round currently being played: the first with anything outstanding.
 *
 * Rounds are worked through in order, so this is the earliest unfinished one
 * rather than simply the last one touched. Returns one past the end when the
 * season is over, which `isSeasonOver` is the readable way to ask about.
 */
export function currentRound(season: Season): number {
  for (let round = 1; round <= totalRounds(season); round++) {
    const outstanding = season.fixtures.some(
      (fixture) => fixture.round === round && !isPlayed(season, fixture),
    )
    if (outstanding) return round
  }
  return totalRounds(season) + 1
}

export function isSeasonOver(season: Season): boolean {
  return season.results.length === season.fixtures.length
}

/** The user's next fixture, or nothing if their season is done. */
export function nextUserFixture(season: Season): Fixture | undefined {
  return season.fixtures.find(
    (fixture) => involves(fixture, season.userTeamId) && !isPlayed(season, fixture),
  )
}

/**
 * Record a scoreline against a fixture.
 *
 * Refuses to record the same fixture twice: a double-recorded result would
 * silently corrupt the table, and every caller here is driven by user actions
 * that a stray click or a reloaded page could repeat.
 */
export function recordResult(
  season: Season,
  fixture: Fixture,
  home: number,
  away: number,
): boolean {
  if (isPlayed(season, fixture)) return false
  if (!season.fixtures.some((scheduled) => sameFixture(scheduled, fixture))) return false

  season.results.push({ fixture, home, away })
  return true
}

/**
 * Play out every outstanding fixture in a round except the user's own.
 *
 * Called when the user finishes their match, so the rest of the round catches up
 * with them. Each fixture is simulated by the real engine rather than sampled
 * from a distribution, so a table position is earned the same way whether the
 * user was watching or not.
 *
 * The seed folds in the fixture's own identity, so a given fixture in a given
 * season always produces the same scoreline no matter what order rounds are
 * resolved in — which is what lets a season be saved, reloaded and continued
 * without the league quietly rewriting its own history.
 */
export function simulateRound(season: Season, round: number, careers?: SeasonCareers): number {
  let played = 0

  for (const fixture of season.fixtures) {
    if (fixture.round !== round) continue
    if (involves(fixture, season.userTeamId)) continue
    if (isPlayed(season, fixture)) continue

    const home = findTeam(fixture.home)
    const away = findTeam(fixture.away)
    const result = simulateMatch(
      home,
      away,
      fixtureSeed(season, fixture),
      careers?.lookupFor({ home, away }),
    )
    recordResult(season, fixture, result.home, result.away)
    // Handed out rather than discarded: the sides the user is chasing improve
    // by playing, exactly as the user's own does.
    careers?.bank(result.exp)
    played += 1
  }

  return played
}

/**
 * The careers a season needs, described rather than imported.
 *
 * `Squad` satisfies this without the league knowing that it exists — the same
 * separation that keeps `core/` from reaching outwards, applied one level down.
 *
 * It has to be a lookup *factory* rather than a lookup: a `CareerLookup` answers
 * questions about `home:` and `away:`, which mean different players in every
 * fixture. The old signature took a single lookup and passed it to every match
 * in the round, which no caller ever used and which could not have been right
 * for more than one of them.
 */
export interface SeasonCareers {
  lookupFor(teams: Record<TeamId, TeamDef>): CareerLookup
  bank(exp: Readonly<Record<string, number>>): void
}

/** Every fixture the user is not in, across the whole season. */
export function simulateRestOfSeason(season: Season, careers?: SeasonCareers): number {
  let played = 0
  for (let round = 1; round <= totalRounds(season); round++) {
    played += simulateRound(season, round, careers)
  }
  return played
}

/** A fixture's own seed: stable regardless of when it is resolved. */
export function fixtureSeed(season: Season, fixture: Fixture): string {
  return `${season.seed}:${fixtureKey(fixture)}`
}
