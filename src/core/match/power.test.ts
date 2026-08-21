import { describe, expect, it } from 'vitest'
import { FLIGHT_SPEED, powerLeft, startPass, startShot } from './flight'
import { PASS_DECAY_PER_UNIT } from '../encounter/formulas'
import { createMatch, stepMatch } from './state'
import { giveBallTo } from './possession'
import { POOL_RADIUS } from '../pitch'
import { BESAID_AUROCHS, LUCA_GOERS } from '../../data/teams'
import type { MatchState, Player } from './types'

const newMatch = (seed = 'power') => createMatch(BESAID_AUROCHS, LUCA_GOERS, seed)

function find(state: MatchState, id: string): Player {
  const player = state.players.find((p) => p.id === id)
  if (!player) throw new Error(`no player ${id}`)
  return player
}

/**
 * The number a throw is settled on, read while it is still travelling.
 *
 * It is what decides whether a pass is held and whether a shot beats the keeper,
 * and it lived only inside the engine until it was put on screen. So the live
 * reading and the figure that actually settles the throw have to be the same
 * arithmetic — a readout that disagreed with the outcome would be worse than no
 * readout, because it would be believed.
 */
describe('what a throw is carrying', () => {
  function throwAcross(state: MatchState, distance: number, power = 30): void {
    const passer = find(state, 'home:wakka')
    const receiver = find(state, 'home:tidus')
    passer.x = 0
    passer.y = 0
    receiver.x = distance
    receiver.y = 0
    giveBallTo(state, passer)
    state.ball.x = 0
    state.ball.y = 0
    state.ball.carrier = null
    state.phase = { kind: 'flight', flight: startPass(passer, receiver, power) }
  }

  it('starts at what was thrown', () => {
    const state = newMatch()
    throwAcross(state, POOL_RADIUS)
    if (state.phase.kind !== 'flight') throw new Error('expected a flight')

    expect(powerLeft(state.phase.flight)).toBe(30)
  })

  it('falls as the throw travels, rather than all at once on arrival', () => {
    const state = newMatch()
    throwAcross(state, POOL_RADIUS)

    const readings: number[] = []
    for (let i = 0; i < 40; i++) {
      stepMatch(state, 1 / 60)
      if (state.phase.kind !== 'flight') break
      readings.push(powerLeft(state.phase.flight))
    }

    expect(readings.length).toBeGreaterThan(10)
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i]!, `reading ${i} rose`).toBeLessThan(readings[i - 1]!)
    }
  })

  it('drops by exactly the decay over the ground it has covered', () => {
    const state = newMatch()
    throwAcross(state, POOL_RADIUS)

    stepMatch(state, 1 / 60)
    if (state.phase.kind !== 'flight') throw new Error('expected a flight')

    const travelled = FLIGHT_SPEED / 60
    expect(powerLeft(state.phase.flight)).toBeCloseTo(30 - travelled * PASS_DECAY_PER_UNIT, 6)
  })

  it('agrees with the outcome: what it says on the last frame is what settles it', () => {
    // Thrown beyond its range, so it arrives spent. Weakly rather than far:
    // decay is 0.02 a unit at this pool size, so a full-strength pass would
    // carry five times the width of the water and cannot be made to fail by
    // distance at all.
    const state = newMatch()
    throwAcross(state, POOL_RADIUS * 1.6, 4)

    let last = Infinity
    for (let i = 0; i < 2000; i++) {
      stepMatch(state, 1 / 60)
      if (state.phase.kind !== 'flight') break
      if (state.phase.flight.kind === 'pass') last = powerLeft(state.phase.flight)
    }

    expect(last).toBeLessThanOrEqual(0)
    // Fumbled to the opposition rather than received.
    const holder = state.players.find((p) => p.id === state.ball.carrier)
    expect(holder?.team ?? 'away').toBe('away')
  })

  it('is still positive on the last frame of a throw that is held', () => {
    const state = newMatch()
    throwAcross(state, 20)

    let last = Infinity
    for (let i = 0; i < 2000; i++) {
      stepMatch(state, 1 / 60)
      if (state.phase.kind !== 'flight') break
      last = powerLeft(state.phase.flight)
    }

    expect(last).toBeGreaterThan(0)
    expect(state.ball.carrier).toBe('home:tidus')
  })

  it('bleeds a shot faster than a pass over the same ground', () => {
    // Shots decay far more steeply, which is what makes range matter for them.
    const state = newMatch()
    const shooter = find(state, 'home:wakka')
    shooter.x = 0
    shooter.y = 0
    giveBallTo(state, shooter)
    state.ball.carrier = null

    const shot = startShot(state, shooter, 30)
    const pass = startPass(shooter, find(state, 'home:tidus'), 30)
    shot.travelled = 20
    pass.travelled = 20

    expect(powerLeft(shot)).toBeLessThan(powerLeft(pass))
  })
})
