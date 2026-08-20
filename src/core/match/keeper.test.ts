import { describe, expect, it } from 'vitest'
import { createMatch, stepMatch, submitEncounterAction } from './state'
import { giveBallTo } from './possession'
import { chooseDistribution, chooseEncounterAction } from '../ai/decisions'
import { openDistribution, resolveEncounter } from '../encounter/encounter'
import type { MatchState, Player } from './types'
import { BESAID_AUROCHS, LUCA_GOERS } from '../../data/teams'

const TICK = 1 / 60
const newMatch = (seed = 'keeper') => createMatch(BESAID_AUROCHS, LUCA_GOERS, seed)

function find(state: MatchState, id: string): Player {
  const player = state.players.find((p) => p.id === id)
  if (!player) throw new Error(`no player ${id}`)
  return player
}

describe('a keeper on the ball', () => {
  it('is put straight into a pass-only decision', () => {
    const state = newMatch()
    const keeper = find(state, 'home:keepa')
    giveBallTo(state, keeper)

    stepMatch(state, TICK)

    expect(state.phase.kind).toBe('encounter')
    if (state.phase.kind === 'encounter') {
      expect(state.phase.encounter.carrierId).toBe(keeper.id)
      expect(state.phase.encounter.kind).toBe('distribution')
      expect(state.phase.encounter.defenders).toEqual([])
    }
  })

  it('is put into that decision even with nobody near them', () => {
    const state = newMatch('alone')
    const keeper = find(state, 'home:keepa')
    for (const other of state.players.filter((p) => p.id !== keeper.id)) {
      other.x = 40
      other.y = 40
    }
    giveBallTo(state, keeper)

    stepMatch(state, TICK)
    expect(state.phase.kind).toBe('encounter')
  })

  it('is never handed to the user to swim', () => {
    const state = newMatch('control')
    const keeper = find(state, 'home:keepa')
    giveBallTo(state, keeper)

    stepMatch(state, TICK)
    expect(state.controlled).not.toBe(keeper.id)

    const controlled = state.players.find((p) => p.id === state.controlled)
    expect(controlled?.slot).not.toBe('GK')
    expect(controlled?.team).toBe('home')
  })

  it('stays on its line rather than swimming upfield', () => {
    const state = newMatch('rooted')
    const keeper = find(state, 'home:keepa')
    giveBallTo(state, keeper)
    const startX = keeper.x

    // Drive hard upfield: the keeper must not respond to it at all.
    for (let i = 0; i < 300; i++) {
      stepMatch(state, TICK, { move: { x: 1, y: 0 } })
      if (state.ball.carrier !== keeper.id) break
    }

    expect(Math.abs(keeper.x - startX)).toBeLessThan(2)
  })

  it('refuses to dribble out', () => {
    const state = newMatch('no-dribble')
    const keeper = find(state, 'home:keepa')
    giveBallTo(state, keeper)
    const encounter = openDistribution(state, keeper)

    const result = resolveEncounter(state, encounter, { kind: 'breakthrough' })

    expect(result.success).toBe(false)
    expect(state.ball.carrier).toBe(keeper.id)
    expect(state.phase.kind).not.toBe('flight')
  })

  it('refuses to shoot', () => {
    const state = newMatch('no-shot')
    const keeper = find(state, 'home:keepa')
    giveBallTo(state, keeper)
    const encounter = openDistribution(state, keeper)

    const result = resolveEncounter(state, encounter, { kind: 'shoot', techniqueId: null })

    expect(result.success).toBe(false)
    expect(state.ball.carrier).toBe(keeper.id)
  })

  it('accepts a pass, which is the one thing it may do', () => {
    const state = newMatch('distribute')
    const keeper = find(state, 'home:keepa')
    giveBallTo(state, keeper)
    stepMatch(state, TICK)

    expect(submitEncounterAction(state, {
      kind: 'pass',
      targetId: 'home:jassu',
      techniqueId: null,
    })).toBe(true)
    expect(state.phase.kind).toBe('flight')
  })
})

describe('keeper distribution AI', () => {
  it('always names a teammate to aim at', () => {
    const state = newMatch('ai')
    const keeper = find(state, 'away:raudy')
    giveBallTo(state, keeper)

    const action = chooseDistribution(state, keeper)
    expect(action.kind).toBe('pass')
    if (action.kind === 'pass') {
      const receiver = find(state, action.targetId)
      expect(receiver.team).toBe('away')
      expect(receiver.slot).not.toBe('GK')
    }
  })

  it('finds someone even when every teammate is marked', () => {
    const state = newMatch('all-marked')
    const keeper = find(state, 'home:keepa')
    giveBallTo(state, keeper)

    // Park an opponent on top of each outfielder.
    const mates = state.players.filter((p) => p.team === 'home' && p.slot !== 'GK')
    const opponents = state.players.filter((p) => p.team === 'away' && p.slot !== 'GK')
    mates.forEach((mate, index) => {
      const marker = opponents[index]
      if (marker) {
        marker.x = mate.x
        marker.y = mate.y + 1
      }
    })

    const action = chooseDistribution(state, keeper)
    expect(action.kind).toBe('pass')
    if (action.kind === 'pass') expect(action.targetId).not.toBe('')
  })

  it('prefers an unmarked teammate to a marked one', () => {
    const state = newMatch('prefers-free')
    const keeper = find(state, 'home:keepa')
    giveBallTo(state, keeper)

    const free = find(state, 'home:jassu')
    const marked = find(state, 'home:letty')
    free.x = -20
    free.y = 15
    marked.x = -20
    marked.y = -15

    for (const opponent of state.players.filter((p) => p.team === 'away' && p.slot !== 'GK')) {
      opponent.x = 40
      opponent.y = 40
    }
    const marker = find(state, 'away:doram')
    marker.x = marked.x
    marker.y = marked.y + 1

    const action = chooseDistribution(state, keeper)
    if (action.kind === 'pass') expect(action.targetId).not.toBe(marked.id)
  })

  it('routes a pass-only encounter through distribution', () => {
    const state = newMatch('routing')
    const keeper = find(state, 'home:keepa')
    giveBallTo(state, keeper)
    const encounter = openDistribution(state, keeper)

    // The general entry point must notice this is a keeper and never suggest
    // dribbling or shooting.
    expect(chooseEncounterAction(state, encounter).kind).toBe('pass')
  })

  it('does not leave a keeper holding the ball for long', () => {
    const state = newMatch('quick')
    const keeper = find(state, 'away:raudy')
    giveBallTo(state, keeper)

    let held = 0
    for (let i = 0; i < 600; i++) {
      stepMatch(state, TICK)
      if (state.ball.carrier === keeper.id) held++
      else break
    }

    // Long enough for the AI to deliberate, nowhere near long enough to loiter.
    expect(held / 60).toBeLessThan(2)
  })
})
