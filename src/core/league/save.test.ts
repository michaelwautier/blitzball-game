import { describe, expect, it } from 'vitest'
import { SAVE_VERSION, deserialise, serialise } from './save'
import {
  createSeason,
  currentRound,
  isPlayed,
  nextUserFixture,
  recordResult,
  seasonTable,
} from './season'
import { createCareer } from '../progression/career'
import { TEAMS } from '../../data/teams'

const IDS = TEAMS.map((team) => team.id)
const USER = 'aurochs'

/** A season with a couple of results already in it. */
function partPlayed(seed = 'save') {
  const season = createSeason(IDS, USER, seed)
  const first = nextUserFixture(season)!
  recordResult(season, first, 4, 2)

  const other = season.fixtures.find(
    (fixture) => fixture.round === 1 && fixture.home !== first.home && fixture.away !== first.away,
  )!
  recordResult(season, other, 0, 3)

  return season
}

describe('a round trip through a save file', () => {
  it('comes back with the same fixtures and results', () => {
    const before = partPlayed()
    const after = deserialise(serialise(before, []))!.season

    expect(after.seed).toBe(before.seed)
    expect(after.userTeamId).toBe(before.userTeamId)
    expect(after.fixtures).toEqual(before.fixtures)
    expect(after.results).toEqual(before.results)
  })

  it('comes back with the same table', () => {
    const before = partPlayed()
    const after = deserialise(serialise(before, []))!.season
    expect(seasonTable(after)).toEqual(seasonTable(before))
  })

  it('knows which fixtures are already played, despite fresh objects', () => {
    // The fixtures on the other side of JSON are different objects entirely.
    const before = partPlayed()
    const after = deserialise(serialise(before, []))!.season

    for (const fixture of before.fixtures) {
      expect(isPlayed(after, fixture), `${fixture.home} v ${fixture.away}`).toBe(
        isPlayed(before, fixture),
      )
    }
  })

  it('resumes on the round it left off', () => {
    const before = partPlayed()
    const after = deserialise(serialise(before, []))!.season
    expect(currentRound(after)).toBe(currentRound(before))
    expect(nextUserFixture(after)).toEqual(nextUserFixture(before))
  })

  it('carries careers across unchanged', () => {
    const careers = [
      { ...createCareer('aurochs:tidus'), level: 4, exp: 260 },
      createCareer('aurochs:wakka'),
    ]
    const restored = deserialise(serialise(createSeason(IDS, USER, 's'), careers))!
    expect(restored.careers).toEqual(careers)
  })

  it('survives a season that has not started', () => {
    const fresh = createSeason(IDS, USER, 'new')
    const after = deserialise(serialise(fresh, []))!.season
    expect(after.results).toEqual([])
    expect(currentRound(after)).toBe(1)
  })
})

describe('a save that cannot be trusted', () => {
  const rejected = (raw: string | null) => expect(deserialise(raw)).toBeUndefined()

  it('refuses nothing at all', () => {
    rejected(null)
    rejected('')
  })

  it('refuses something that is not JSON', () => {
    rejected('{"version":')
    rejected('not json at all')
  })

  it('refuses JSON that is not an object', () => {
    rejected('[]')
    rejected('42')
    rejected('null')
  })

  it('refuses a version it does not know', () => {
    const file = JSON.parse(serialise(partPlayed(), []))
    rejected(JSON.stringify({ ...file, version: SAVE_VERSION + 1 }))
    rejected(JSON.stringify({ ...file, version: 'one' }))
  })

  it('refuses a file missing what it needs', () => {
    const file = JSON.parse(serialise(partPlayed(), []))
    for (const key of ['seed', 'userTeamId', 'teamIds', 'results', 'careers']) {
      const damaged = { ...file }
      delete damaged[key]
      rejected(JSON.stringify(damaged))
    }
  })

  it('refuses a league with nobody in it', () => {
    const file = JSON.parse(serialise(partPlayed(), []))
    rejected(JSON.stringify({ ...file, teamIds: [] }))
  })

  it('refuses a manager who is not in their own league', () => {
    const file = JSON.parse(serialise(partPlayed(), []))
    rejected(JSON.stringify({ ...file, userTeamId: 'zanarkand' }))
  })

  it('refuses scorelines that are not scorelines', () => {
    const file = JSON.parse(serialise(partPlayed(), []))
    for (const bad of [-1, 1.5, '3', null, NaN]) {
      const damaged = structuredClone(file)
      damaged.results[0].homeGoals = bad
      rejected(JSON.stringify(damaged))
    }
  })

  it('refuses careers that are not careers', () => {
    const file = JSON.parse(serialise(partPlayed(), [createCareer('aurochs:tidus')]))
    const damaged = structuredClone(file)
    delete damaged.careers[0].level
    rejected(JSON.stringify(damaged))
  })
})

describe('a save from a league that has since changed', () => {
  it('drops a result naming a fixture this league does not have', () => {
    const file = JSON.parse(serialise(partPlayed(), []))
    file.results.push({ round: 1, home: 'aurochs', away: 'zanarkand', homeGoals: 9, awayGoals: 0 })

    const restored = deserialise(JSON.stringify(file))!
    // Loaded, minus the match nobody can account for.
    expect(restored.season.results).toHaveLength(2)
    expect(seasonTable(restored.season).every((row) => row.scored < 9)).toBe(true)
  })

  it('drops a result recorded twice rather than doubling it', () => {
    const file = JSON.parse(serialise(partPlayed(), []))
    file.results.push({ ...file.results[0] })

    const restored = deserialise(JSON.stringify(file))!
    expect(restored.season.results).toHaveLength(2)
  })
})
