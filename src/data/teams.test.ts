import { describe, expect, it } from 'vitest'
import { TEAMS, findPlayer } from './teams'
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

  it('throws a useful error for an unknown player', () => {
    expect(() => findPlayer(TEAMS[0]!, 'nobody')).toThrow(/nobody/)
  })
})
