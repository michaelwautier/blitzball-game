import { simulateMatch } from './simulate'
import { TEAMS } from '../../data/teams'
import type { TeamDef } from '../../data/types'

/**
 * The instrument behind "balance is measured, not guessed".
 *
 * Every pairing in the league, at both ends of the pool, several times each —
 * played by the real engine, the real formulas and the real AI. One match tells
 * you almost nothing: scorelines swing on a single catch roll. Three hundred of
 * them tell you whether a constant you moved made the game better or merely
 * different.
 *
 * It reads as a league table because that is the question worth asking. A change
 * that lifts the goal rate but flattens six teams into one is not an improvement,
 * and an average alone would hide that.
 *
 * Kept in the repository rather than rebuilt from memory each time it is needed:
 * a measurement is only worth anything if the next one is taken the same way.
 * Run it with `npm run ladder`.
 */

export interface LadderRow {
  id: string
  name: string
  played: number
  won: number
  drawn: number
  lost: number
  for: number
  against: number
  points: number
}

export interface LadderReport {
  rows: LadderRow[]
  matches: number
  goalsPerMatch: number
  /** Share of fixtures that finished nil-nil, as a fraction. */
  goallessShare: number
  encountersPerMatch: number
  shotsPerMatch: number
  breaksPerMatch: number
}

/** Matches per ordered pairing. Ten is 300 fixtures, and about half a minute. */
export const DEFAULT_RUNS = 10

/**
 * Play the whole ladder.
 *
 * Seeded from the fixture itself, so the same ladder always reads the same and
 * two runs either side of a change differ only by the change.
 */
export function runLadder(runs = DEFAULT_RUNS, teams: readonly TeamDef[] = TEAMS): LadderReport {
  const rows = new Map<string, LadderRow>(
    teams.map((team) => [
      team.id,
      {
        id: team.id,
        name: team.abbreviation,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        for: 0,
        against: 0,
        points: 0,
      },
    ]),
  )

  let matches = 0
  let goals = 0
  let goalless = 0
  let encounters = 0
  let shots = 0
  let breaks = 0

  for (const home of teams) {
    for (const away of teams) {
      if (home.id === away.id) continue

      for (let run = 0; run < runs; run++) {
        const result = simulateMatch(home, away, `ladder-${home.id}-${away.id}-${run}`)

        matches++
        goals += result.home + result.away
        if (result.home + result.away === 0) goalless++
        encounters += result.encounters
        shots += result.shots
        breaks += result.breakthroughs

        record(rows.get(home.id), result.home, result.away)
        record(rows.get(away.id), result.away, result.home)
      }
    }
  }

  return {
    rows: [...rows.values()].sort(byPointsThenDifference),
    matches,
    goalsPerMatch: matches === 0 ? 0 : goals / matches,
    goallessShare: matches === 0 ? 0 : goalless / matches,
    encountersPerMatch: matches === 0 ? 0 : encounters / matches,
    shotsPerMatch: matches === 0 ? 0 : shots / matches,
    breaksPerMatch: matches === 0 ? 0 : breaks / matches,
  }
}

function record(row: LadderRow | undefined, scored: number, conceded: number): void {
  if (!row) return

  row.played++
  row.for += scored
  row.against += conceded

  if (scored > conceded) {
    row.won++
    row.points += 3
  } else if (scored < conceded) {
    row.lost++
  } else {
    row.drawn++
    row.points += 1
  }
}

const difference = (row: LadderRow): number => row.for - row.against

function byPointsThenDifference(a: LadderRow, b: LadderRow): number {
  return b.points - a.points || difference(b) - difference(a) || b.for - a.for
}

/**
 * The report as a table, in the shape every balance note in `PLAN.md` quotes.
 *
 * Deliberately narrow enough to paste into a commit message, which is where
 * these measurements have to end up if the next change is to be judged against
 * this one.
 */
export function formatLadder(report: LadderReport): string {
  const table = report.rows
    .map(
      (row) =>
        `${row.name} ${String(row.points).padStart(3)}pts ` +
        `${row.won}-${row.drawn}-${row.lost} ${row.for}:${row.against}`,
    )
    .join('\n')

  const summary =
    `matches ${report.matches}` +
    ` · goals/match ${report.goalsPerMatch.toFixed(2)}` +
    ` · goalless ${(report.goallessShare * 100).toFixed(0)}%` +
    ` · encounters/match ${report.encountersPerMatch.toFixed(1)}` +
    ` · shots/match ${report.shotsPerMatch.toFixed(1)}` +
    ` · breaks/match ${report.breaksPerMatch.toFixed(1)}`

  return `${table}\n\n${summary}`
}
