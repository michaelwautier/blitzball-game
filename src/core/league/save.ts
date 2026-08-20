import { createSeason, recordResult, type Season } from './season'
import type { PlayerCareer } from '../progression/career'

/**
 * Saving and restoring a season.
 *
 * The file holds the least it can get away with: the seed, who the user is
 * managing, the sides in the league, the scorelines so far, and everyone's
 * career. The fixture list is *not* stored — it is regenerated from the team
 * list, which is deterministic, so a save cannot contain a schedule that
 * disagrees with the one the game would build. Simulated results are not stored
 * as such either; they are simply results, and the fixture seeding guarantees an
 * unplayed fixture resolves the same way whenever it is reached.
 *
 * Everything here treats stored data as untrusted. A save is a string that has
 * been sitting in a browser between releases, and the honest assumption is that
 * it may be truncated, hand-edited, or written by a version that no longer
 * exists. Loading never throws: it returns nothing and the caller starts a new
 * season.
 */

export const SAVE_KEY = 'blitzball:season'

/** Bumped whenever the shape below changes incompatibly. Old saves are dropped. */
export const SAVE_VERSION = 1

interface StoredResult {
  round: number
  home: string
  away: string
  homeGoals: number
  awayGoals: number
}

interface SaveFile {
  version: number
  seed: string
  userTeamId: string
  teamIds: string[]
  results: StoredResult[]
  careers: PlayerCareer[]
}

export interface SavedGame {
  season: Season
  careers: PlayerCareer[]
}

export function serialise(season: Season, careers: readonly PlayerCareer[]): string {
  const file: SaveFile = {
    version: SAVE_VERSION,
    seed: season.seed,
    userTeamId: season.userTeamId,
    teamIds: [...season.teamIds],
    results: season.results.map((result) => ({
      round: result.fixture.round,
      home: result.fixture.home,
      away: result.fixture.away,
      homeGoals: result.home,
      awayGoals: result.away,
    })),
    careers: [...careers],
  }

  return JSON.stringify(file)
}

/**
 * Rebuild a season from a saved string, or nothing if it cannot be trusted.
 *
 * Results are replayed through `recordResult` rather than assigned, so a save
 * carrying a fixture this league does not have — a team that has since been
 * renamed, a schedule from an older version — drops that result instead of
 * poisoning the table with a match nobody can account for.
 */
export function deserialise(raw: string | null): SavedGame | undefined {
  const file = parse(raw)
  if (!file) return undefined

  let season: Season
  try {
    season = createSeason(file.teamIds, file.userTeamId, file.seed)
  } catch {
    // The user's team is no longer in the league it was saved with.
    return undefined
  }

  for (const result of file.results) {
    recordResult(
      season,
      { round: result.round, home: result.home, away: result.away },
      result.homeGoals,
      result.awayGoals,
    )
  }

  return { season, careers: file.careers }
}

/** Parse and validate, without trusting a byte of it. */
function parse(raw: string | null): SaveFile | undefined {
  if (!raw) return undefined

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }

  if (!isRecord(value)) return undefined
  if (value.version !== SAVE_VERSION) return undefined
  if (typeof value.seed !== 'string') return undefined
  if (typeof value.userTeamId !== 'string') return undefined
  if (!isArrayOf(value.teamIds, (id): id is string => typeof id === 'string')) return undefined
  if (value.teamIds.length === 0) return undefined
  if (!isArrayOf(value.results, isStoredResult)) return undefined
  if (!isArrayOf(value.careers, isCareer)) return undefined

  return {
    version: value.version,
    seed: value.seed,
    userTeamId: value.userTeamId,
    teamIds: value.teamIds,
    results: value.results,
    careers: value.careers,
  }
}

function isStoredResult(value: unknown): value is StoredResult {
  return (
    isRecord(value) &&
    Number.isInteger(value.round) &&
    typeof value.home === 'string' &&
    typeof value.away === 'string' &&
    isScore(value.homeGoals) &&
    isScore(value.awayGoals)
  )
}

function isCareer(value: unknown): value is PlayerCareer {
  return (
    isRecord(value) &&
    typeof value.playerId === 'string' &&
    Number.isFinite(value.level) &&
    Number.isFinite(value.exp) &&
    isRecord(value.gains)
  )
}

const isScore = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isArrayOf = <T>(value: unknown, each: (item: unknown) => item is T): value is T[] =>
  Array.isArray(value) && value.every(each)

/**
 * Where a save actually lives.
 *
 * Behind an interface so the season logic never touches `localStorage` directly:
 * storage throws in private browsing and when a quota is exceeded, and a game
 * that cannot save is still a game that should keep running.
 */
export interface SaveSlot {
  read(): string | null
  write(value: string): void
  clear(): void
}

export function localStorageSlot(key = SAVE_KEY): SaveSlot {
  return {
    read: () => {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    write: (value) => {
      try {
        localStorage.setItem(key, value)
      } catch {
        // Full, or blocked. Losing the save is not worth losing the match.
      }
    },
    clear: () => {
      try {
        localStorage.removeItem(key)
      } catch {
        // Nothing to be done, and nothing that needs saying.
      }
    },
  }
}
