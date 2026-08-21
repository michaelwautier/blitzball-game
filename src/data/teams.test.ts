import { describe, expect, it } from 'vitest'
import { CANON_TEAMS, TEAMS, findPlayer, findTeam } from './teams'
import { EXPANSION_TEAMS } from './expansion-teams'
import { findTechnique } from './techniques'
import { POSITION_KEYS, type PlayerStats } from './types'

const STAT_KEYS: readonly (keyof PlayerStats)[] = ['hp', 'sp', 'en', 'at', 'pa', 'bl', 'sh', 'ca']

describe('team data', () => {
  it.each(TEAMS.map((team) => [team.name, team] as const))('%s is well formed', (_name, team) => {
    expect(team.roster.length).toBeGreaterThanOrEqual(6)
    expect(new Set(team.roster.map((p) => p.id)).size).toBe(team.roster.length)
  })

  it.each(TEAMS.map((team) => [team.name, team] as const))(
    '%s fields a full lineup from its own roster',
    (_name, team) => {
      for (const slot of POSITION_KEYS) {
        const player = findPlayer(team, team.lineup[slot])
        expect(player).toBeDefined()
      }
      const named = POSITION_KEYS.map((slot) => team.lineup[slot])
      expect(new Set(named).size, 'a player cannot fill two positions').toBe(named.length)
    },
  )

  it.each(TEAMS.map((team) => [team.name, team] as const))(
    '%s has positive stats for everyone',
    (_name, team) => {
      for (const player of team.roster) {
        for (const key of STAT_KEYS) {
          expect(player.stats[key], `${player.name}.${key}`).toBeGreaterThan(0)
        }
      }
    },
  )

  it.each(TEAMS.map((team) => [team.name, team] as const))(
    '%s starts a keeper with a real catching stat',
    (_name, team) => {
      const keeper = findPlayer(team, team.lineup.GK)
      expect(keeper.natural).toBe('GK')
      const outfielders = team.roster.filter((p) => p.id !== keeper.id)
      for (const player of outfielders) {
        expect(keeper.stats.ca, `${keeper.name} vs ${player.name}`).toBeGreaterThan(player.stats.ca)
      }
    },
  )

  it.each(TEAMS.map((team) => [team.name, team] as const))(
    '%s only names techniques that exist',
    (_name, team) => {
      for (const player of team.roster) {
        for (const id of player.techniques) {
          expect(() => findTechnique(id), `${player.name} knows ${id}`).not.toThrow()
        }
      }
    },
  )

  it.each(TEAMS.map((team) => [team.name, team] as const))(
    '%s grows every stat it starts low on',
    (_name, team) => {
      for (const player of team.roster) {
        for (const key of STAT_KEYS) {
          expect(player.growth[key], `${player.name}.${key}`).toBeGreaterThanOrEqual(0)
        }
      }
    },
  )

  it('throws a useful error for an unknown player', () => {
    expect(() => findPlayer(TEAMS[0]!, 'nobody')).toThrow(/nobody/)
  })
})

describe('the league of teams', () => {
  it('fields Square\'s six, and ours on top', () => {
    // Stated as a relationship rather than a count, so adding a side is a
    // deliberate act rather than a number to bump. The six are the league in
    // FFX; the rest are ours and live in their own file.
    expect(CANON_TEAMS).toHaveLength(6)
    expect(TEAMS).toHaveLength(CANON_TEAMS.length + EXPANSION_TEAMS.length)
    for (const team of CANON_TEAMS) expect(TEAMS).toContain(team)
  })

  it('keeps the invented sides out of the transcribed ones', () => {
    // The whole reason the two files are separate: a measurement has to be
    // traceable back to whether it came from Square's numbers or ours.
    for (const team of EXPANSION_TEAMS) expect(CANON_TEAMS).not.toContain(team)
  })

  it('keeps ids, names and abbreviations unique, so results can be told apart', () => {
    for (const key of ['id', 'name', 'abbreviation'] as const) {
      const values = TEAMS.map((team) => team[key])
      expect(new Set(values).size, `duplicate ${key}`).toBe(values.length)
    }
  })

  it('gives every side a colour of its own to play in', () => {
    const primaries = TEAMS.map((team) => team.colours.primary.toLowerCase())
    expect(new Set(primaries).size).toBe(primaries.length)
  })

  it('numbers player ids per team, so two sides may both have a Datto', () => {
    for (const team of TEAMS) {
      expect(new Set(team.roster.map((p) => p.id)).size).toBe(team.roster.length)
    }
  })

  it('looks a side up by id', () => {
    expect(findTeam('fangs').name).toBe('Ronso Fangs')
    expect(findTeam('psyches').lineup.GK).toBe('nimrook')
  })

  it('throws a useful error for an unknown side', () => {
    expect(() => findTeam('zanarkand')).toThrow(/zanarkand/)
  })
})
