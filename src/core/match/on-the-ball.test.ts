import { describe, expect, it } from 'vitest'
import {
  cancelActionMenu,
  createMatch,
  requestActionMenu,
  stepMatch,
  submitEncounterAction,
} from './state'
import { giveBallTo } from './possession'
import { allowedActions, openOnTheBall, resolveEncounter } from '../encounter/encounter'
import { chooseEncounterAction } from '../ai/decisions'
import type { MatchState, Player } from './types'
import { BESAID_AUROCHS, LUCA_GOERS } from '../../data/teams'

const TICK = 1 / 60
const newMatch = (seed = 'onball') => createMatch(BESAID_AUROCHS, LUCA_GOERS, seed)

function find(state: MatchState, id: string): Player {
  const player = state.players.find((p) => p.id === id)
  if (!player) throw new Error(`no player ${id}`)
  return player
}

/** Give the user's side the ball in open play, well clear of any defender. */
function inTheClear(state: MatchState, id = 'home:tidus'): Player {
  const carrier = find(state, id)
  carrier.x = 0
  carrier.y = 0
  for (const opponent of state.players.filter((p) => p.team === 'away')) {
    opponent.x = 44
    opponent.y = 20
  }
  giveBallTo(state, carrier)
  state.phase = { kind: 'play' }
  return carrier
}

describe('what each decision permits', () => {
  it('allows everything when defenders have committed', () => {
    expect(allowedActions('contested')).toEqual(['breakthrough', 'pass', 'shoot'])
  })

  it('offers no breakthrough when nobody is on the carrier', () => {
    expect(allowedActions('onTheBall')).toEqual(['pass', 'shoot'])
  })

  it('allows a keeper only to pass', () => {
    expect(allowedActions('distribution')).toEqual(['pass'])
  })
})

describe('stopping on the ball', () => {
  it('opens a decision on demand during open play', () => {
    const state = newMatch()
    const carrier = inTheClear(state)

    expect(requestActionMenu(state)).toBe(true)
    expect(state.phase.kind).toBe('encounter')
    if (state.phase.kind === 'encounter') {
      expect(state.phase.encounter.kind).toBe('onTheBall')
      expect(state.phase.encounter.carrierId).toBe(carrier.id)
      expect(state.phase.encounter.defenders).toEqual([])
    }
  })

  it('stops the clock while the menu is open', () => {
    const state = newMatch('clock')
    inTheClear(state)
    requestActionMenu(state)

    const frozen = state.clock
    for (let i = 0; i < 120; i++) stepMatch(state, TICK)
    expect(state.clock).toBe(frozen)
  })

  it('is refused when the user does not have the ball', () => {
    const state = newMatch('theirs')
    const theirs = find(state, 'away:bickson')
    giveBallTo(state, theirs)
    state.phase = { kind: 'play' }

    expect(requestActionMenu(state)).toBe(false)
    expect(state.phase.kind).toBe('play')
  })

  it('is refused when the ball is loose', () => {
    const state = newMatch('loose')
    state.ball.carrier = null
    state.phase = { kind: 'play' }
    expect(requestActionMenu(state)).toBe(false)
  })

  it('is refused for a keeper, who gets their own decision anyway', () => {
    const state = newMatch('keeper')
    const keeper = find(state, 'home:keepa')
    giveBallTo(state, keeper)
    state.phase = { kind: 'play' }
    expect(requestActionMenu(state)).toBe(false)
  })

  it('is refused while play is already stopped', () => {
    const state = newMatch('stopped')
    inTheClear(state)
    requestActionMenu(state)
    // A second request must not reopen or nest anything.
    expect(requestActionMenu(state)).toBe(false)
  })

  it('is refused at full time', () => {
    const state = newMatch('over')
    inTheClear(state)
    state.phase = { kind: 'fullTime' }
    expect(requestActionMenu(state)).toBe(false)
  })
})

describe('backing out', () => {
  it('returns to play with the ball still held', () => {
    const state = newMatch('cancel')
    const carrier = inTheClear(state)
    requestActionMenu(state)

    expect(cancelActionMenu(state)).toBe(true)
    expect(state.phase.kind).toBe('play')
    expect(state.ball.carrier).toBe(carrier.id)
  })

  it('cannot be used to escape defenders who have committed', () => {
    const state = newMatch('committed')
    const carrier = find(state, 'home:tidus')
    giveBallTo(state, carrier)
    state.phase = {
      kind: 'encounter',
      encounter: {
        kind: 'contested',
        carrierId: carrier.id,
        defenders: [{ id: 'away:doram', attack: 9, block: 5 }],
        endurance: 10,
        thinkTimer: 0,
        awaitingDefence: false,
        defence: null,
      },
    }

    expect(cancelActionMenu(state)).toBe(false)
    expect(state.phase.kind).toBe('encounter')
  })

  it('cannot be used by a keeper to hold on to the ball', () => {
    const state = newMatch('keeper-cancel')
    const keeper = find(state, 'home:keepa')
    giveBallTo(state, keeper)
    stepMatch(state, TICK)

    expect(state.phase.kind).toBe('encounter')
    expect(cancelActionMenu(state)).toBe(false)
  })

  it('does nothing during open play', () => {
    const state = newMatch('no-menu')
    inTheClear(state)
    expect(cancelActionMenu(state)).toBe(false)
  })
})

describe('acting from an on-the-ball decision', () => {
  it('accepts a shot', () => {
    const state = newMatch('shoot')
    inTheClear(state)
    requestActionMenu(state)

    expect(submitEncounterAction(state, { kind: 'shoot', techniqueId: null })).toBe(true)
    expect(state.phase.kind).toBe('flight')
  })

  it('accepts a pass', () => {
    const state = newMatch('pass')
    inTheClear(state)
    requestActionMenu(state)

    expect(
      submitEncounterAction(state, { kind: 'pass', targetId: 'home:wakka', techniqueId: null }),
    ).toBe(true)
    expect(state.phase.kind).toBe('flight')
  })

  it('refuses a breakthrough, since there is nobody to break past', () => {
    const state = newMatch('no-barge')
    const carrier = inTheClear(state)
    const encounter = openOnTheBall(state, carrier)

    const result = resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })

    expect(result.success).toBe(false)
    expect(state.ball.carrier).toBe(carrier.id)
    expect(state.phase.kind).not.toBe('flight')
  })

  it('costs no endurance when refused', () => {
    const state = newMatch('no-cost')
    const carrier = inTheClear(state)
    const before = carrier.hp
    const encounter = openOnTheBall(state, carrier)

    resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })
    expect(carrier.hp).toBe(before)
  })

  it('never has the AI suggest a breakthrough for one', () => {
    const state = newMatch('ai')
    const carrier = inTheClear(state)
    const encounter = openOnTheBall(state, carrier)
    expect(chooseEncounterAction(state, encounter).kind).not.toBe('breakthrough')
  })
})
