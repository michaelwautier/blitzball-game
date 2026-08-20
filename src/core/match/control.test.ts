import { describe, expect, it } from 'vitest'
import { createMatch, stepMatch, switchControlled } from './state'
import { giveBallTo } from './possession'
import type { MatchState, Player } from './types'
import { BESAID_AUROCHS, LUCA_GOERS } from '../../data/teams'

const TICK = 1 / 60
const newMatch = (seed = 'control') => createMatch(BESAID_AUROCHS, LUCA_GOERS, seed)

function find(state: MatchState, id: string): Player {
  const player = state.players.find((p) => p.id === id)
  if (!player) throw new Error(`no player ${id}`)
  return player
}

/** Hold possession with the opponent and keep it there, so control cannot follow it. */
function opponentHolds(state: MatchState, carrierId = 'away:bickson'): Player {
  const carrier = find(state, carrierId)
  carrier.x = 0
  carrier.y = 0
  giveBallTo(state, carrier)
  state.phase = { kind: 'play' }
  return carrier
}

describe('who the user is steering', () => {
  it('follows possession onto the carrier', () => {
    const state = newMatch()
    const wakka = find(state, 'home:wakka')
    giveBallTo(state, wakka)

    stepMatch(state, TICK)
    expect(state.controlled).toBe(wakka.id)
  })

  it('stays put while the opponent keeps the ball', () => {
    const state = newMatch('sticky')
    const carrier = opponentHolds(state)
    const held = find(state, 'home:datto')
    state.controlled = held.id

    // Drive the ball right across the pool; control must not chase it.
    for (let i = 0; i < 300; i++) {
      carrier.x = -40 + (i / 300) * 80
      stepMatch(state, TICK)
      // Possession is pinned to the opponent for the whole run.
      giveBallTo(state, carrier)
      expect(state.controlled).toBe(held.id)
    }
  })

  it('never leaves the user steering a keeper', () => {
    const state = newMatch('keeper')
    const keeper = find(state, 'home:keepa')
    giveBallTo(state, keeper)

    stepMatch(state, TICK)
    expect(state.controlled).not.toBe(keeper.id)
    expect(find(state, state.controlled).slot).not.toBe('GK')
  })

  it('recovers if the held player somehow becomes invalid', () => {
    const state = newMatch('invalid')
    opponentHolds(state)
    state.controlled = 'nobody'

    stepMatch(state, TICK)
    const controlled = find(state, state.controlled)
    expect(controlled.team).toBe('home')
    expect(controlled.slot).not.toBe('GK')
  })
})

describe('switching player', () => {
  it('takes whoever is closest to the player on the ball', () => {
    const state = newMatch('switch')
    const carrier = opponentHolds(state)

    const near = find(state, 'home:letty')
    near.x = 4
    near.y = 0
    const far = find(state, 'home:datto')
    far.x = -40
    far.y = 20
    state.controlled = far.id

    expect(switchControlled(state)).toBe(true)
    expect(state.controlled).toBe(near.id)
    expect(carrier.team).toBe('away')
  })

  it('reports that it did nothing when already on the closest', () => {
    const state = newMatch('already')
    opponentHolds(state)

    const near = find(state, 'home:letty')
    near.x = 4
    near.y = 0
    for (const other of state.players.filter((p) => p.team === 'home' && p.id !== near.id)) {
      other.x = -45
      other.y = 25
    }
    state.controlled = near.id

    expect(switchControlled(state)).toBe(false)
    expect(state.controlled).toBe(near.id)
  })

  it('refuses when the ball is already ours', () => {
    const state = newMatch('ours')
    const wakka = find(state, 'home:wakka')
    giveBallTo(state, wakka)
    stepMatch(state, TICK)

    expect(switchControlled(state)).toBe(false)
    expect(state.controlled).toBe(wakka.id)
  })

  it('chases a loose ball when nobody has it', () => {
    const state = newMatch('loose')
    state.ball.carrier = null
    state.ball.x = 20
    state.ball.y = 10

    const near = find(state, 'home:datto')
    near.x = 22
    near.y = 10
    for (const other of state.players.filter((p) => p.team === 'home' && p.id !== near.id)) {
      other.x = -45
      other.y = -25
    }
    state.controlled = 'home:tidus'

    expect(switchControlled(state)).toBe(true)
    expect(state.controlled).toBe(near.id)
  })

  it('never hands over the keeper, however close they are', () => {
    const state = newMatch('not-keeper')
    const carrier = opponentHolds(state)
    const keeper = find(state, 'home:keepa')
    keeper.x = carrier.x + 1
    keeper.y = carrier.y

    switchControlled(state)
    expect(state.controlled).not.toBe(keeper.id)
  })
})
