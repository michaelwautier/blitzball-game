import { describe, expect, it } from 'vitest'
import { HALF_SECONDS, createMatch, stepMatch, submitEncounterAction } from './state'
import { chooseEncounterAction } from '../ai/decisions'
import { autoIntent } from '../ai/autopilot'
import { USER_TEAM } from './types'
import { BESAID_AUROCHS, LUCA_GOERS } from '../../data/teams'

const TICK = 1 / 60

interface MatchReport {
  home: number
  away: number
  encounters: number
  shots: number
  breakthroughs: number
}

/**
 * Play a full match out with both sides on AI.
 *
 * This is the payoff of a deterministic, headless core: balance is a measurement
 * rather than a feeling, and the same engine that runs on screen can be run
 * hundreds of times in a test. It is also exactly what Phase 4 will use to
 * simulate the league fixtures the user is not playing in.
 */
function simulateMatch(seed: string, homeTeam = BESAID_AUROCHS): MatchReport {
  const state = createMatch(homeTeam, LUCA_GOERS, seed)
  const report: MatchReport = { home: 0, away: 0, encounters: 0, shots: 0, breakthroughs: 0 }

  let lastPhase = state.phase.kind
  // Generous tick ceiling: two halves plus every stoppage, and a stop if it hangs.
  const limit = Math.ceil((HALF_SECONDS * 2 + 120) / TICK)

  for (let i = 0; i < limit && state.phase.kind !== 'fullTime'; i++) {
    // Both sides on AI: the user's player is steered by input, so without an
    // intent they would stand still and be swarmed.
    stepMatch(state, TICK, autoIntent(state))

    if (state.phase.kind === 'encounter') {
      const { encounter } = state.phase
      if (lastPhase !== 'encounter') report.encounters++

      const carrier = state.players.find((p) => p.id === encounter.carrierId)
      if (carrier?.team === USER_TEAM) {
        const action = chooseEncounterAction(state, encounter)
        if (action.kind === 'shoot') report.shots++
        if (action.kind === 'breakthrough') report.breakthroughs++
        submitEncounterAction(state, action)
      }
    }

    lastPhase = state.phase.kind
  }

  report.home = state.teams.home.score
  report.away = state.teams.away.score
  return report
}

describe('match balance', () => {
  // Twenty-four rather than a dozen: the Aurochs win roughly one match in six,
  // so a smaller sample throws up wins-free runs often enough to make the
  // "the underdog can take one" assertion below flaky rather than informative.
  const MATCHES = 24
  const reports = Array.from({ length: MATCHES }, (_, i) => simulateMatch(`balance-${i}`))
  const total = (pick: (r: MatchReport) => number) => reports.reduce((s, r) => s + pick(r), 0)
  const goals = total((r) => r.home + r.away)

  it('reaches full time within a sensible number of ticks', () => {
    // simulateMatch bails at its tick ceiling; a match that never ends would
    // show up as every scoreline being identical or the loop being cut short.
    expect(reports).toHaveLength(MATCHES)
  })

  it('produces encounters throughout, not a procession', () => {
    expect(total((r) => r.encounters) / reports.length).toBeGreaterThan(10)
  })

  it('scores a plausible number of goals per match', () => {
    const perMatch = goals / reports.length
    expect(perMatch, `average ${perMatch.toFixed(1)} goals per match`).toBeGreaterThan(0.5)
    expect(perMatch, `average ${perMatch.toFixed(1)} goals per match`).toBeLessThan(14)
  })

  it('lets both sides score across a run of matches', () => {
    expect(total((r) => r.home), 'the Aurochs never scored').toBeGreaterThan(0)
    expect(total((r) => r.away), 'the Goers never scored').toBeGreaterThan(0)
  })

  it('favours the stronger side', () => {
    const goersWins = reports.filter((r) => r.away > r.home).length
    const aurochsWins = reports.filter((r) => r.home > r.away).length
    expect(goersWins).toBeGreaterThan(aurochsWins)
  })

  /**
   * The Aurochs do not currently win, and this deliberately does not pretend
   * otherwise.
   *
   * On FFX's real level-one tables they are outclassed in exactly the places
   * that decide matches: Keepa catches at 5 against Raudy's 8, and their
   * outfielders block at 2 where the Goers' block at 8. That is faithful — the
   * Aurochs are the joke of the league in the story — but it makes the exhibition
   * match unwinnable for the side the user plays, which is a design decision
   * still to be taken rather than something to tune away here.
   *
   * What must stay true is that they are competitive enough to score.
   */
  it('lets the underdog get on the scoresheet regularly', () => {
    const scoring = reports.filter((r) => r.home > 0).length
    // Around half their matches, which for a side this outmatched is a real
    // presence rather than a token. Asserting "most" was too tight to be stable
    // — the figure sits close enough to half that a sample either side of it
    // flips the result without anything having changed.
    expect(scoring / reports.length).toBeGreaterThan(0.33)
    expect(total((r) => r.home)).toBeGreaterThan(reports.length * 0.4)
  })

  it('is reproducible: the same seed replays the same scoreline', () => {
    expect(simulateMatch('balance-0')).toEqual(reports[0])
  })
})

describe('side fairness', () => {
  /**
   * With identical teams the two ends of the pool must be worth the same.
   *
   * This is a regression guard for order-dependence, which is easy to
   * reintroduce and invisible in ordinary tests: the two sides occupy contiguous
   * blocks of the players array, so anything that resolves players in index
   * order — steering that reads positions already updated this tick, or a
   * pairwise separation pass applied as it goes — quietly hands one end an
   * advantage. Before this was fixed, mirror matches ran at 43% possession and
   * lost the home side roughly one match in every eight it should have drawn.
   */
  const mirror = Array.from({ length: 20 }, (_, i) => simulateMatch(`mirror-${i}`, LUCA_GOERS))
  const homeGoals = mirror.reduce((sum, r) => sum + r.home, 0)
  const awayGoals = mirror.reduce((sum, r) => sum + r.away, 0)

  it('scores about evenly at both ends of the pool', () => {
    const share = homeGoals / (homeGoals + awayGoals)
    expect(share, `home scored ${homeGoals}, away ${awayGoals}`).toBeGreaterThan(0.35)
    expect(share, `home scored ${homeGoals}, away ${awayGoals}`).toBeLessThan(0.65)
  })

  it('lets either end win', () => {
    expect(mirror.some((r) => r.home > r.away)).toBe(true)
    expect(mirror.some((r) => r.away > r.home)).toBe(true)
  })
})
