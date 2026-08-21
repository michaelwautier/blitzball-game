import {
  HALF_SECONDS,
  createMatch,
  requestActionMenu,
  stepMatch,
  submitDefence,
  submitEncounterAction,
  type CareerLookup,
} from '../match/state'
import { chooseEncounterAction, chooseTackleTechnique, shouldStopAndShoot } from '../ai/decisions'
import { autoIntent } from '../ai/autopilot'
import { USER_TEAM } from '../match/types'
import { TICK_SECONDS } from '../loop'
import type { TeamDef } from '../../data/types'

/**
 * Play a match out with nobody watching.
 *
 * This is the payoff of a simulation core that never touches the renderer: the
 * fixtures the user is not playing in are resolved by the same engine, the same
 * formulas and the same AI as the one they are, rather than by a separate table
 * of invented probabilities. A league result and a played result mean the same
 * thing.
 *
 * It is also how balance is measured rather than guessed — see the ladder in
 * `balance.test.ts`, which runs this across every pairing in the league.
 */

export interface SimulatedMatch {
  home: number
  away: number
  /** How many times the two sides actually met. Zero means something is wrong. */
  encounters: number
  shots: number
  breakthroughs: number
  /**
   * What everyone earned, keyed `teamId:playerId` and ready to be banked.
   *
   * Keyed by the *team* rather than by which end they played at, because a
   * career belongs to a player and not to a fixture. Returned rather than
   * applied here: this module simulates, and whether a result is kept is the
   * league's business.
   */
  exp: Record<string, number>
}

/**
 * How much slack the tick ceiling allows beyond the two halves.
 *
 * Stoppages — celebrations, the clock held at an encounter, keepers restarting —
 * all take real time on top of the ninety seconds a half is worth. The ceiling
 * exists only so a match that somehow cannot reach full time ends the loop
 * rather than hanging the caller.
 */
const STOPPAGE_ALLOWANCE_SECONDS = 120

export function simulateMatch(
  home: TeamDef,
  away: TeamDef,
  seed: string,
  careers?: CareerLookup,
): SimulatedMatch {
  const state = createMatch(home, away, seed, careers)
  const result: SimulatedMatch = {
    home: 0,
    away: 0,
    encounters: 0,
    shots: 0,
    breakthroughs: 0,
    exp: {},
  }

  let previousPhase = state.phase.kind
  const limit = Math.ceil((HALF_SECONDS * 2 + STOPPAGE_ALLOWANCE_SECONDS) / TICK_SECONDS)

  for (let tick = 0; tick < limit && state.phase.kind !== 'fullTime'; tick++) {
    // Both sides on AI. The user's player is normally steered by input, so
    // without an intent they would hold still and be swarmed.
    stepMatch(state, TICK_SECONDS, autoIntent(state))

    // The engine opens this for the AI of its own accord; the user's side is
    // waiting on a person who is not here, so it needs the same prompt.
    const onBall = state.players.find((player) => player.id === state.ball.carrier)
    if (
      state.phase.kind === 'play' &&
      onBall?.team === USER_TEAM &&
      onBall.slot !== 'GK' &&
      shouldStopAndShoot(state, onBall)
    ) {
      requestActionMenu(state)
    }

    if (state.phase.kind === 'encounter' && state.phase.encounter.awaitingDefence) {
      submitDefence(state, chooseTackleTechnique(state, state.phase.encounter))
    }

    if (state.phase.kind === 'encounter') {
      const { encounter } = state.phase
      if (previousPhase !== 'encounter') result.encounters += 1

      const carrier = state.players.find((player) => player.id === encounter.carrierId)
      if (carrier?.team === USER_TEAM) {
        const action = chooseEncounterAction(state, encounter)
        if (action.kind === 'shoot') result.shots += 1
        if (action.kind === 'breakthrough') result.breakthroughs += 1
        submitEncounterAction(state, action)
      }
    }

    previousPhase = state.phase.kind
  }

  result.home = state.teams.home.score
  result.away = state.teams.away.score

  // Everyone who did something earned something, both sides alike. Translated
  // out of the fixture's own `home:` / `away:` naming and into the team's, so a
  // player carries one career whichever end they happen to be playing at.
  for (const player of state.players) {
    const earned = state.exp[player.id] ?? 0
    if (earned <= 0) continue
    const team = player.team === 'home' ? home : away
    result.exp[`${team.id}:${player.def.id}`] = earned
  }

  return result
}
