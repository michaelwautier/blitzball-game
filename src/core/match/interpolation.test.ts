import { describe, expect, it } from 'vitest'
import { createMatch, requestActionMenu, stepMatch } from './state'
import { giveBallTo } from './possession'
import { startShot } from './flight'
import { autoIntent } from '../ai/autopilot'
import type { Movable } from './movement'
import type { MatchState, Player } from './types'
import { BESAID_AUROCHS, LUCA_GOERS } from '../../data/teams'

const TICK = 1 / 60
const newMatch = (seed = 'interp') => createMatch(BESAID_AUROCHS, LUCA_GOERS, seed)

function find(state: MatchState, id: string): Player {
  const player = state.players.find((p) => p.id === id)
  if (!player) throw new Error(`no player ${id}`)
  return player
}

/**
 * How far a body would appear to move across one frame of interpolation.
 *
 * The renderer draws between the previous and current position using the tick
 * fraction, so this is exactly the distance a viewer sees it sweep. Anything
 * above zero while the world is frozen is a body oscillating in place.
 */
const gap = (m: Movable) => Math.hypot(m.x - m.prevX, m.y - m.prevY)

const worstGap = (state: MatchState) => Math.max(...state.players.map(gap), gap(state.ball))

/** Run until a moving tick has actually happened, so gaps are non-zero to begin with. */
function playFor(state: MatchState, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepMatch(state, TICK, autoIntent(state))
}

describe('nothing is drawn moving while play is stopped', () => {
  it('holds every body still through an encounter', () => {
    const state = newMatch('frozen')
    playFor(state, 240)

    const carrier = state.players.find((p) => p.id === state.ball.carrier)
    if (carrier?.team === 'home' && carrier.slot !== 'GK') {
      requestActionMenu(state)
    } else {
      const tidus = find(state, 'home:tidus')
      giveBallTo(state, tidus)
      requestActionMenu(state)
    }
    expect(state.phase.kind).toBe('encounter')

    // The tick that freezes play must itself close the gap, not the one after.
    stepMatch(state, TICK)
    expect(worstGap(state)).toBe(0)

    for (let i = 0; i < 60; i++) {
      stepMatch(state, TICK)
      expect(worstGap(state), `frame ${i} of a frozen encounter`).toBe(0)
    }
  })

  it('holds still through a goal celebration', () => {
    const state = newMatch('goal')
    playFor(state, 120)
    state.phase = { kind: 'celebration', scorer: 'home', timer: 2 }

    for (let i = 0; i < 30; i++) {
      stepMatch(state, TICK)
      expect(worstGap(state)).toBe(0)
    }
  })

  it('holds still through half time', () => {
    const state = newMatch('half')
    playFor(state, 120)
    state.phase = { kind: 'halfTime', timer: 2 }

    for (let i = 0; i < 30; i++) {
      stepMatch(state, TICK)
      expect(worstGap(state)).toBe(0)
    }
  })

  it('holds still at full time', () => {
    const state = newMatch('end')
    playFor(state, 120)
    state.phase = { kind: 'fullTime' }

    for (let i = 0; i < 30; i++) {
      stepMatch(state, TICK)
      expect(worstGap(state)).toBe(0)
    }
  })
})

describe('bodies that are moved rather than swum', () => {
  it('does not draw cleared attackers streaking away from a save', () => {
    const state = newMatch('save')
    playFor(state, 120)

    const keeper = find(state, 'home:keepa')
    const attacker = find(state, 'away:bickson')
    // Park the attacker on top of the keeper so the clearance definitely moves them.
    attacker.x = keeper.x + 2
    attacker.y = keeper.y
    attacker.prevX = attacker.x
    attacker.prevY = attacker.y
    // An unbeatable keeper, so the shot is certainly claimed.
    keeper.stats = { ...keeper.stats, ca: 500 }

    state.ball.carrier = null
    state.ball.x = attacker.x
    state.ball.y = attacker.y
    state.phase = { kind: 'flight', flight: startShot(state, attacker, 40) }

    for (let i = 0; i < 240 && state.phase.kind === 'flight'; i++) stepMatch(state, TICK)

    expect(state.announcement).toContain('saves')
    // They were moved a long way; the renderer must not sweep across it.
    expect(gap(attacker)).toBe(0)
  })

  it('starts a kickoff with everyone already in place', () => {
    const state = newMatch('kickoff')
    playFor(state, 300)
    state.phase = { kind: 'celebration', scorer: 'away', timer: 0.01 }

    // Step past the restart, which returns everyone to their own half.
    for (let i = 0; i < 5 && state.phase.kind === 'celebration'; i++) stepMatch(state, TICK)

    expect(state.phase.kind).toBe('play')
    expect(worstGap(state)).toBe(0)
  })
})

describe('motion is still interpolated during play', () => {
  it('leaves a gap for bodies that are genuinely moving', () => {
    const state = newMatch('moving')
    playFor(state, 120)

    // Guard against fixing the flicker by disabling interpolation altogether:
    // a swimming player must still have somewhere to be drawn between.
    expect(worstGap(state)).toBeGreaterThan(0)
  })
})
