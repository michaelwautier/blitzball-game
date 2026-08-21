import { describe, expect, it } from 'vitest'
import { DEFAULT_RUNS, formatLadder, runLadder, type LadderReport } from './ladder'
import { BESAID_AUROCHS, LUCA_GOERS, TEAMS } from '../../data/teams'

/**
 * Vitest provides this; the project has no Node types and does not want them for
 * one environment variable.
 */
declare const process: {
  env: Record<string, string | undefined>
  stderr: { write: (text: string) => void }
}

/**
 * The ladder is a measuring instrument, so it needs to be right about the thing
 * it measures — a table that miscounts a draw would send a balance decision the
 * wrong way, silently, and every note in `PLAN.md` after it would be wrong too.
 *
 * These run against two teams so they stay fast. The full thirty-pairing run is
 * below, behind `npm run ladder`.
 */
describe('the ladder table', () => {
  const twoTeams = [BESAID_AUROCHS, LUCA_GOERS]
  // Played once and shared: every assertion below is about the same table, and
  // simulating four full matches per `it` is real time for no extra coverage.
  const report = runLadder(2, twoTeams)

  it('plays every ordering of every pairing', () => {
    // Two teams, both orderings, twice each.
    expect(report.matches).toBe(4)
    expect(report.rows.every((row) => row.played === 4)).toBe(true)
  })

  it('gives every match to exactly one column', () => {
    for (const row of report.rows) {
      expect(row.won + row.drawn + row.lost).toBe(row.played)
    }
  })

  it('counts goals the same from both ends', () => {
    // One side's goals for are the other's against, so the two totals must
    // agree. They would not if a fixture were credited to the wrong row.
    const scored = report.rows.reduce((sum, row) => sum + row.for, 0)
    const conceded = report.rows.reduce((sum, row) => sum + row.against, 0)
    expect(scored).toBe(conceded)
  })

  it('awards three for a win and one each for a draw', () => {
    for (const row of report.rows) {
      expect(row.points).toBe(row.won * 3 + row.drawn)
    }
  })

  it('orders on points, then goal difference', () => {
    const first = report.rows[0]!
    const second = report.rows[1]!
    expect(first.points).toBeGreaterThanOrEqual(second.points)
    if (first.points === second.points) {
      expect(first.for - first.against).toBeGreaterThanOrEqual(second.for - second.against)
    }
  })

  it(
    'reads the same twice, so two runs differ only by what changed',
    () => {
      // The whole method rests on this. A ladder that wandered between runs
      // could not tell a real effect from noise.
      expect(runLadder(2, twoTeams)).toEqual(report)
    },
    // This one actually plays matches inside the test rather than sharing the
    // table above, and four of them is more than the default five seconds
    // allows on a cold CI runner.
    30_000,
  )

  it('says nothing rather than dividing by nothing when there is no league', () => {
    const empty = runLadder(2, [BESAID_AUROCHS])
    expect(empty.matches).toBe(0)
    expect(empty.goalsPerMatch).toBe(0)
  })
})

describe('the report as text', () => {
  it('puts every side in the table and the rates underneath', () => {
    const report = runLadder(1, [BESAID_AUROCHS, LUCA_GOERS])
    const text = formatLadder(report)

    expect(text).toContain(BESAID_AUROCHS.abbreviation)
    expect(text).toContain(LUCA_GOERS.abbreviation)
    expect(text).toContain('goals/match')
    expect(text).toContain('goalless')
  })
})

/**
 * The real thing: every pairing in the league, both ends, ten times each.
 *
 * Skipped by default because it is half a minute of simulation and proves
 * nothing on its own — it is an instrument, not an assertion. `npm run ladder`
 * sets the variable that turns it on and prints the table.
 */
describe.skipIf(!process.env.LADDER)('the full ladder', () => {
  // `LADDER_RUNS=20 npm run ladder` doubles the sample. The extra runs are new
  // seeds rather than repeats, which is how to tell a real effect from a lucky
  // one before a balance constant is moved on the strength of it.
  const runs = Number(process.env.LADDER_RUNS ?? DEFAULT_RUNS)

  it('plays the whole league', () => {
    const report: LadderReport = runLadder(runs, TEAMS)
    process.stderr.write(`\n${formatLadder(report)}\n`)
    expect(report.matches).toBe(TEAMS.length * (TEAMS.length - 1) * runs)
  }, 1_800_000)
})
