import { describe, expect, it } from 'vitest'
import {
  POINTS_FOR_A_DRAW,
  POINTS_FOR_A_WIN,
  positionOf,
  standings,
  type MatchResult,
} from './standings'

const TEAMS = ['aurochs', 'goers', 'psyches']

/** A result, without the ceremony of building a fixture by hand each time. */
const played = (home: string, away: string, hg: number, ag: number): MatchResult => ({
  fixture: { round: 1, home, away },
  home: hg,
  away: ag,
})

const rowFor = (table: ReturnType<typeof standings>, teamId: string) =>
  table.find((row) => row.teamId === teamId)!

describe('the table', () => {
  it('lists every side, even before a ball is thrown', () => {
    const table = standings(TEAMS, [])
    expect(table).toHaveLength(TEAMS.length)
    expect(table.every((row) => row.played === 0 && row.points === 0)).toBe(true)
  })

  it('pays three for a win and one for a draw', () => {
    const table = standings(TEAMS, [
      played('aurochs', 'goers', 2, 1),
      played('goers', 'psyches', 1, 1),
    ])

    expect(rowFor(table, 'aurochs').points).toBe(POINTS_FOR_A_WIN)
    expect(rowFor(table, 'goers').points).toBe(POINTS_FOR_A_DRAW)
    expect(rowFor(table, 'psyches').points).toBe(POINTS_FOR_A_DRAW)
  })

  it('counts a win for the away side too', () => {
    const table = standings(TEAMS, [played('aurochs', 'goers', 0, 3)])
    expect(rowFor(table, 'goers').won).toBe(1)
    expect(rowFor(table, 'aurochs').lost).toBe(1)
  })

  it('adds up goals at both ends', () => {
    const table = standings(TEAMS, [
      played('aurochs', 'goers', 2, 1),
      played('psyches', 'aurochs', 4, 0),
    ])

    const aurochs = rowFor(table, 'aurochs')
    expect(aurochs.played).toBe(2)
    expect(aurochs.scored).toBe(2)
    expect(aurochs.conceded).toBe(5)
    expect(aurochs.difference).toBe(-3)
  })

  it('keeps played equal to wins, draws and losses', () => {
    const table = standings(TEAMS, [
      played('aurochs', 'goers', 2, 1),
      played('goers', 'psyches', 1, 1),
      played('psyches', 'aurochs', 4, 0),
    ])

    for (const row of table) {
      expect(row.won + row.drawn + row.lost, row.teamId).toBe(row.played)
    }
  })

  it('ignores a result naming a side outside the league', () => {
    const table = standings(TEAMS, [played('aurochs', 'ronso', 5, 0)])
    // Not counted for the Aurochs either: half a result is worse than none.
    expect(rowFor(table, 'aurochs').played).toBe(0)
  })
})

describe('the order sides come out in', () => {
  it('puts the most points first', () => {
    const table = standings(TEAMS, [
      played('aurochs', 'goers', 1, 0),
      played('aurochs', 'psyches', 1, 0),
      played('goers', 'psyches', 1, 0),
    ])
    expect(table.map((row) => row.teamId)).toEqual(['aurochs', 'goers', 'psyches'])
  })

  it('separates sides level on points by goal difference', () => {
    const table = standings(TEAMS, [
      played('aurochs', 'psyches', 5, 0),
      played('goers', 'psyches', 1, 0),
    ])
    // Both on three; the Aurochs won by more.
    expect(rowFor(table, 'aurochs').points).toBe(rowFor(table, 'goers').points)
    expect(table[0]!.teamId).toBe('aurochs')
  })

  it('separates sides level on difference by goals scored', () => {
    const table = standings(TEAMS, [
      played('aurochs', 'psyches', 4, 3),
      played('goers', 'psyches', 1, 0),
    ])
    expect(rowFor(table, 'aurochs').difference).toBe(rowFor(table, 'goers').difference)
    expect(table[0]!.teamId).toBe('aurochs')
  })

  it('is stable when two sides are level in every respect', () => {
    // Not a coin toss that changes between renders: the same season must show
    // the same table twice running.
    const results = [played('aurochs', 'goers', 1, 1)]
    const once = standings(TEAMS, results).map((row) => row.teamId)
    const twice = standings([...TEAMS].reverse(), results).map((row) => row.teamId)
    expect(once).toEqual(twice)
  })
})

describe('finding a side in the table', () => {
  it('reports its position, counting from one', () => {
    const table = standings(TEAMS, [played('goers', 'aurochs', 3, 0)])
    expect(positionOf(table, 'goers')).toBe(1)
  })

  it('reports zero for a side that is not there', () => {
    expect(positionOf(standings(TEAMS, []), 'ronso')).toBe(0)
  })
})
