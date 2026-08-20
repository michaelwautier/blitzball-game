/**
 * The season's fixture list.
 *
 * A double round-robin: every side plays every other side twice, once at each
 * end of the pool. Six teams give five rounds a leg, three matches a round, and
 * thirty fixtures across the season.
 */

export interface Fixture {
  /** 1-based round this fixture is played in. */
  round: number
  /** Team ids. */
  home: string
  away: string
}

/** How many legs a season plays. Two: one fixture at each end of the pool. */
export const LEGS = 2

/**
 * Build a double round-robin schedule.
 *
 * The circle method: hold the first team fixed and rotate the rest, which pairs
 * everyone exactly once per leg. Odd-sized leagues get a bye by pairing against
 * a placeholder that is then dropped, so this does not require an even number of
 * teams — the six real ones are even, but nothing here depends on that, and a
 * league that gains a team should not silently drop a third of its fixtures.
 *
 * Home and away alternate by round as well as by leg, so no side plays its whole
 * first leg at home.
 */
export function roundRobin(teamIds: readonly string[], legs = LEGS): Fixture[] {
  if (teamIds.length < 2) return []

  const BYE = Symbol('bye')
  const wheel: (string | typeof BYE)[] = [...teamIds]
  if (wheel.length % 2 === 1) wheel.push(BYE)

  const roundsPerLeg = wheel.length - 1
  const half = wheel.length / 2
  const fixtures: Fixture[] = []

  for (let leg = 0; leg < legs; leg++) {
    for (let round = 0; round < roundsPerLeg; round++) {
      for (let pair = 0; pair < half; pair++) {
        const first = wheel[pair]!
        const second = wheel[wheel.length - 1 - pair]!
        if (first === BYE || second === BYE) continue

        // Alternate which side is at home, by both round and leg, so a team
        // does not spend a whole leg away from its own pool.
        const homeFirst = (round + leg) % 2 === 0
        fixtures.push({
          round: leg * roundsPerLeg + round + 1,
          home: homeFirst ? first : second,
          away: homeFirst ? second : first,
        })
      }

      rotate(wheel)
    }
  }

  return fixtures
}

/** Rotate all but the first entry one place, the circle method's step. */
function rotate<T>(wheel: T[]): void {
  if (wheel.length < 3) return
  const last = wheel.pop()!
  wheel.splice(1, 0, last)
}

/** How many rounds a schedule runs to. */
export function roundsIn(fixtures: readonly Fixture[]): number {
  return fixtures.reduce((most, fixture) => Math.max(most, fixture.round), 0)
}

/** Every fixture in one round, in schedule order. */
export function fixturesInRound(fixtures: readonly Fixture[], round: number): Fixture[] {
  return fixtures.filter((fixture) => fixture.round === round)
}

/** Whether this fixture involves the given team, at either end. */
export function involves(fixture: Fixture, teamId: string): boolean {
  return fixture.home === teamId || fixture.away === teamId
}

/**
 * A fixture's identity, as a string.
 *
 * Fixtures are compared by what they are rather than by object identity, so a
 * season restored from a save file — where every fixture is a freshly parsed
 * object — still knows which of them have been played. Identity comparison
 * worked right up until there was a save file, which is exactly the kind of bug
 * that only shows up once someone reloads the page.
 */
export function fixtureKey(fixture: Fixture): string {
  return `${fixture.round}:${fixture.home}-${fixture.away}`
}

/** Whether two fixtures are the same fixture. */
export function sameFixture(a: Fixture, b: Fixture): boolean {
  return fixtureKey(a) === fixtureKey(b)
}
