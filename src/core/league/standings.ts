import type { Fixture } from './fixtures'

/**
 * The league table.
 *
 * Derived from the results every time rather than accumulated as matches are
 * played: a table that is recomputed cannot drift out of step with the results
 * it claims to summarise, and a season loaded from a save file needs no separate
 * table to be trustworthy.
 */

export interface MatchResult {
  fixture: Fixture
  /** Goals scored by the fixture's home and away sides. */
  home: number
  away: number
}

export interface TableRow {
  teamId: string
  played: number
  won: number
  drawn: number
  lost: number
  scored: number
  conceded: number
  /** Goal difference, the first tiebreak after points. */
  difference: number
  points: number
}

export const POINTS_FOR_A_WIN = 3
export const POINTS_FOR_A_DRAW = 1

/**
 * The table as it stands, best first.
 *
 * Ordered on points, then goal difference, then goals scored, and finally team
 * id so that two sides who are level in every respect still come out in a
 * stable order rather than one that depends on how the results were iterated.
 */
export function standings(
  teamIds: readonly string[],
  results: readonly MatchResult[],
): TableRow[] {
  const rows = new Map<string, TableRow>(
    teamIds.map((teamId) => [teamId, blankRow(teamId)]),
  )

  for (const result of results) {
    const home = rows.get(result.fixture.home)
    const away = rows.get(result.fixture.away)
    // A result naming a team outside this league is not ours to count.
    if (!home || !away) continue

    record(home, result.home, result.away)
    record(away, result.away, result.home)
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.difference - a.difference ||
      b.scored - a.scored ||
      a.teamId.localeCompare(b.teamId),
  )
}

/** One side's row from one match. */
function record(row: TableRow, scored: number, conceded: number): void {
  row.played += 1
  row.scored += scored
  row.conceded += conceded
  row.difference = row.scored - row.conceded

  if (scored > conceded) {
    row.won += 1
    row.points += POINTS_FOR_A_WIN
  } else if (scored === conceded) {
    row.drawn += 1
    row.points += POINTS_FOR_A_DRAW
  } else {
    row.lost += 1
  }
}

function blankRow(teamId: string): TableRow {
  return {
    teamId,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    scored: 0,
    conceded: 0,
    difference: 0,
    points: 0,
  }
}

/** Where a team sits in the table, 1-based. */
export function positionOf(table: readonly TableRow[], teamId: string): number {
  return table.findIndex((row) => row.teamId === teamId) + 1
}
