import { describe, expect, it } from 'vitest'
import {
  HALF_SECONDS,
  createMatch,
  stepMatch,
  submitEncounterAction,
} from './state'
import { giveBallTo } from './possession'
import { startPass, startShot } from './flight'
import { chooseEncounterAction } from '../ai/decisions'
import { USER_TEAM, type MatchState, type Player } from './types'
import { BESAID_AUROCHS, LUCA_GOERS } from '../../data/teams'

const TICK = 1 / 60

const newMatch = (seed = 'phases') => createMatch(BESAID_AUROCHS, LUCA_GOERS, seed)

function find(state: MatchState, id: string): Player {
  const player = state.players.find((p) => p.id === id)
  if (!player) throw new Error(`no player ${id}`)
  return player
}

/**
 * Run a match with both sides on AI, resolving the user's encounters the same
 * way the opponent resolves theirs. Without this the user's carrier would hold
 * an encounter open forever, waiting for input that never comes.
 */
function runAutoplay(state: MatchState, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    stepMatch(state, TICK)
    if (state.phase.kind === 'encounter') {
      const { encounter } = state.phase
      const carrier = state.players.find((p) => p.id === encounter.carrierId)
      if (carrier?.team === USER_TEAM) {
        submitEncounterAction(state, chooseEncounterAction(state, encounter))
      }
    }
  }
}

describe('the clock', () => {
  it('counts down through the half', () => {
    const state = newMatch()
    expect(state.clock).toBe(HALF_SECONDS)
    runAutoplay(state, 600)
    expect(state.clock).toBeLessThan(HALF_SECONDS)
    expect(state.clock).toBeGreaterThan(HALF_SECONDS - 11)
  })

  it('stops while an encounter is open, so thinking is free', () => {
    const state = newMatch('frozen')
    const carrier = find(state, 'home:tidus')
    giveBallTo(state, carrier)
    // Force an encounter by parking two opponents on the carrier.
    for (const defender of ['away:doram', 'away:balgerda']) {
      const player = find(state, defender)
      player.x = carrier.x
      player.y = carrier.y + 1
    }
    state.engageCooldown = 0

    for (let i = 0; i < 60 && state.phase.kind !== 'encounter'; i++) stepMatch(state, TICK)
    expect(state.phase.kind).toBe('encounter')

    const frozen = state.clock
    for (let i = 0; i < 120; i++) stepMatch(state, TICK)
    expect(state.clock).toBe(frozen)
  })

  it('breaks for half time when the first half expires', () => {
    const state = newMatch('half')
    state.clock = 0.5
    runAutoplay(state, 60)
    expect(state.phase.kind).toBe('halfTime')
    expect(state.half).toBe(1)
  })

  it('swaps ends for the second half', () => {
    const state = newMatch('swap')
    const homeDefendedFirst = state.teams.home.defending
    state.clock = 0.1
    runAutoplay(state, 60 * 5)

    expect(state.half).toBe(2)
    expect(state.teams.home.defending).not.toBe(homeDefendedFirst)
    expect(state.teams.home.defending).not.toBe(state.teams.away.defending)
    expect(state.clock).toBeGreaterThan(HALF_SECONDS - 5)
  })

  it('ends the match after the second half', () => {
    const state = newMatch('end')
    state.half = 2
    state.clock = 0.1
    runAutoplay(state, 60)
    expect(state.phase.kind).toBe('fullTime')
  })

  it('stays finished once it is over', () => {
    const state = newMatch('finished')
    state.half = 2
    state.clock = 0.1
    runAutoplay(state, 600)
    expect(state.phase.kind).toBe('fullTime')
  })
})

describe('ball in flight', () => {
  it('delivers an uncontested pass to its target', () => {
    const state = newMatch('pass')
    const passer = find(state, 'home:tidus')
    const receiver = find(state, 'home:wakka')
    passer.x = -10
    passer.y = 0
    receiver.x = 0
    receiver.y = 0
    // Clear the area so nobody contests it.
    for (const other of state.players.filter((p) => p.team === 'away')) {
      other.x = 45
      other.y = 45
    }

    giveBallTo(state, passer)
    state.ball.x = passer.x
    state.ball.y = passer.y
    state.ball.carrier = null
    state.phase = { kind: 'flight', flight: startPass(state, passer, receiver) }

    for (let i = 0; i < 120 && state.phase.kind === 'flight'; i++) stepMatch(state, TICK)

    expect(state.phase.kind).toBe('play')
    expect(state.ball.carrier).toBe(receiver.id)
  })

  it('lets a defender in the way intercept it', () => {
    const state = newMatch('intercept')
    const passer = find(state, 'home:tidus')
    const receiver = find(state, 'home:wakka')
    passer.x = -20
    passer.y = 0
    receiver.x = 20
    receiver.y = 0

    // A wall of defenders across the passing lane, each taking a bite.
    const blockers = state.players.filter((p) => p.team === 'away' && p.slot !== 'GK')
    blockers.forEach((blocker, index) => {
      blocker.x = -12 + index * 5
      blocker.y = 0
    })

    state.ball.x = passer.x
    state.ball.y = passer.y
    state.ball.carrier = null
    state.phase = { kind: 'flight', flight: startPass(state, passer, receiver) }

    for (let i = 0; i < 240 && state.phase.kind === 'flight'; i++) stepMatch(state, TICK)

    expect(state.ball.carrier).not.toBe(receiver.id)
    expect(state.phase.kind).not.toBe('flight')
  })

  it('scores when a shot beats the keeper', () => {
    const state = newMatch('goal')
    const shooter = find(state, 'home:wakka')
    shooter.x = 30
    shooter.y = 0
    for (const other of state.players.filter((p) => p.id !== shooter.id)) {
      other.x = -40
      other.y = 40
    }
    // A keeper who cannot possibly reach it.
    const keeper = find(state, 'away:raudy')
    keeper.def = { ...keeper.def, stats: { ...keeper.def.stats, ca: 0 } }

    state.ball.carrier = null
    state.ball.x = shooter.x
    state.ball.y = shooter.y
    state.phase = { kind: 'flight', flight: startShot(state, shooter) }

    for (let i = 0; i < 240 && state.phase.kind === 'flight'; i++) stepMatch(state, TICK)

    expect(state.teams.home.score).toBe(1)
    expect(state.phase.kind).toBe('celebration')
  })

  it('restarts from the centre after a goal', () => {
    const state = newMatch('restart')
    const scorer = find(state, 'home:tidus')
    scorer.x = 30
    scorer.y = 20
    state.phase = { kind: 'celebration', scorer: 'home', timer: 0.1 }

    // Stop the moment play resumes: the kickoff ball has scatter and drifts.
    for (let i = 0; i < 30 && state.phase.kind === 'celebration'; i++) stepMatch(state, TICK)

    expect(state.phase.kind).toBe('play')
    expect(state.ball.x).toBe(0)
    expect(state.ball.y).toBe(0)
    expect(state.ball.carrier).toBeNull()
    // Everyone is back in their own half for the restart.
    expect(scorer.x).toBeLessThan(0)
  })

  it('is saved by a keeper who can reach it', () => {
    const state = newMatch('save')
    const shooter = find(state, 'home:datto')
    shooter.x = 10
    shooter.y = 0
    for (const other of state.players.filter((p) => p.id !== shooter.id)) {
      other.x = -40
      other.y = 40
    }
    // An unbeatable keeper, back on the line where the shot is aimed.
    const keeper = find(state, 'away:raudy')
    keeper.def = { ...keeper.def, stats: { ...keeper.def.stats, ca: 500 } }
    keeper.x = 46
    keeper.y = 0

    state.ball.carrier = null
    state.ball.x = shooter.x
    state.ball.y = shooter.y
    state.phase = { kind: 'flight', flight: startShot(state, shooter) }

    for (let i = 0; i < 240 && state.phase.kind === 'flight'; i++) stepMatch(state, TICK)

    expect(state.teams.home.score).toBe(0)
    expect(state.ball.carrier).toBe(keeper.id)
  })
})

describe('encounter input', () => {
  it('ignores an action when no encounter is open', () => {
    const state = newMatch('no-enc')
    expect(submitEncounterAction(state, { kind: 'shoot', techniqueId: null })).toBe(false)
  })

  it('ignores an action aimed at the opponent s encounter', () => {
    const state = newMatch('their-enc')
    const carrier = find(state, 'away:bickson')
    giveBallTo(state, carrier)
    state.phase = {
      kind: 'encounter',
      encounter: {
        carrierId: carrier.id,
        defenders: [{ id: 'home:letty', attack: 9 }],
        endurance: 10,
        thinkTimer: 5,
      },
    }
    expect(submitEncounterAction(state, { kind: 'shoot', techniqueId: null })).toBe(false)
  })

  it('accepts an action on the user s own encounter', () => {
    const state = newMatch('our-enc')
    const carrier = find(state, 'home:tidus')
    giveBallTo(state, carrier)
    state.phase = {
      kind: 'encounter',
      encounter: {
        carrierId: carrier.id,
        defenders: [{ id: 'away:doram', attack: 9 }],
        endurance: 100,
        thinkTimer: 0,
      },
    }
    expect(submitEncounterAction(state, { kind: 'breakthrough' })).toBe(true)
    expect(state.phase.kind).toBe('play')
  })
})
