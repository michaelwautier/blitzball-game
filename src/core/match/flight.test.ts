import { describe, expect, it } from 'vitest'
import { createMatch, stepMatch } from './state'
import { giveBallTo } from './possession'
import { keeperFor } from './queries'
import { startPass, startShot } from './flight'
import type { MatchState, Player } from './types'
import { BESAID_AUROCHS, LUCA_GOERS } from '../../data/teams'

const TICK = 1 / 60
const newMatch = (seed = 'flight') => createMatch(BESAID_AUROCHS, LUCA_GOERS, seed)

function find(state: MatchState, id: string): Player {
  const player = state.players.find((p) => p.id === id)
  if (!player) throw new Error(`no player ${id}`)
  return player
}

/**
 * A pass of `power` from Wakka to Tidus, `distance` apart, with an opponent
 * planted halfway along the line it has to travel.
 */
function passAcross(power: number, distance: number, seed = 'across') {
  const state = newMatch(seed)
  const passer = find(state, 'home:wakka')
  const receiver = find(state, 'home:tidus')

  passer.x = -distance / 2
  passer.y = 0
  receiver.x = distance / 2
  receiver.y = 0
  giveBallTo(state, passer)

  // Directly on the trajectory, and much nearer the middle than the receiver is.
  const onThePath = find(state, 'away:doram')
  onThePath.x = 0
  onThePath.y = 0

  // Everyone else well away, so "nearest opponent" is unambiguous.
  for (const other of state.players.filter((p) => p.team === 'away' && p.id !== onThePath.id)) {
    other.x = 95
    other.y = 60
  }

  state.ball.carrier = null
  state.ball.x = passer.x
  state.ball.y = passer.y
  state.phase = { kind: 'flight', flight: startPass(passer, receiver, power) }
  return { state, passer, receiver, onThePath }
}

/** Run until the ball is settled with somebody, or give up. */
function untilSettled(state: MatchState, ticks = 1200): void {
  for (let i = 0; i < ticks && state.phase.kind === 'flight'; i++) stepMatch(state, TICK)
}

describe('a throw reaches where it was aimed', () => {
  it('arrives at the receiver even when it has nothing left', () => {
    // Far beyond the passer's range: it still gets there.
    const { state, receiver } = passAcross(2, 120, 'beyond')
    untilSettled(state)

    const settled = Math.hypot(state.ball.x - receiver.x, state.ball.y - receiver.y)
    const carrier = state.players.find((p) => p.id === state.ball.carrier)
    // Either the receiver held it, or it was spilled from where they stood.
    expect(carrier, 'the ball vanished').toBeDefined()
    expect(settled).toBeLessThan(120)
  })

  it('is not taken by a defender standing on its path', () => {
    // The old fault: power drained in the air, so a weak throw died mid-flight
    // and was collected by whoever happened to be standing there — which reads
    // as an interception by a defender who is not allowed to intercept.
    //
    // Collecting the *spill* afterwards is a different thing and allowed, so
    // this watches only the throw itself.
    const { state, onThePath, receiver } = passAcross(2, 120, 'no-mid-air')

    for (let i = 0; i < 1200; i++) {
      stepMatch(state, TICK)
      if (state.phase.kind !== 'flight') break
      if (state.phase.flight.kind === 'spilled') break
      expect(state.ball.carrier, 'someone took it mid-flight').toBeNull()
    }

    // And when it did end, it had reached the receiver rather than dying at his feet.
    expect(Math.abs(state.ball.x - receiver.x), 'it died on the way').toBeLessThan(2)
    expect(onThePath.x).toBe(0)
  })

  it('completes when the passer has the range for it', () => {
    const { state, receiver } = passAcross(60, 30, 'in-range')
    untilSettled(state)
    expect(state.ball.carrier).toBe(receiver.id)
  })
})

describe('a throw that arrives spent', () => {
  it('is fumbled at the receiver rather than dying on the way', () => {
    const { state, receiver } = passAcross(2, 120, 'fumbled')

    // Step to the moment it arrives and spills.
    for (let i = 0; i < 1200; i++) {
      stepMatch(state, TICK)
      if (state.phase.kind === 'flight' && state.phase.flight.kind === 'spilled') break
    }

    expect(state.phase.kind).toBe('flight')
    if (state.phase.kind !== 'flight') return
    expect(state.phase.flight.kind).toBe('spilled')
    // It spilled from where the receiver was, not from the middle of the pool.
    expect(Math.abs(state.ball.x - receiver.x)).toBeLessThan(2)
  })

  it('travels to whoever collects it rather than teleporting', () => {
    const { state } = passAcross(2, 120, 'travels')
    for (let i = 0; i < 1200; i++) {
      stepMatch(state, TICK)
      if (state.phase.kind === 'flight' && state.phase.flight.kind === 'spilled') break
    }
    if (state.phase.kind !== 'flight') throw new Error('expected a spill')

    const from = { x: state.ball.x, y: state.ball.y }
    // Still in the air, and covering ground on its way to them.
    stepMatch(state, TICK)
    stepMatch(state, TICK)
    expect(Math.hypot(state.ball.x - from.x, state.ball.y - from.y)).toBeGreaterThan(0)
  })

  it('ends up with an opponent, since a fumble is a turnover', () => {
    const { state } = passAcross(2, 120, 'turnover')
    untilSettled(state)

    const carrier = state.players.find((p) => p.id === state.ball.carrier)
    expect(carrier?.team).toBe('away')
  })

  it('says what happened', () => {
    const { state } = passAcross(2, 120, 'announced')
    for (let i = 0; i < 1200; i++) {
      stepMatch(state, TICK)
      if (state.phase.kind === 'flight' && state.phase.flight.kind === 'spilled') break
    }
    expect(state.announcement).toContain('Out of range')
  })
})

describe('a shot that arrives spent', () => {
  it('still has to be saved, however little is left of it', () => {
    const state = newMatch('short-shot')
    const shooter = find(state, 'home:wakka')
    shooter.x = 0
    shooter.y = 0
    state.ball.carrier = null
    state.ball.x = shooter.x
    state.ball.y = shooter.y
    state.phase = { kind: 'flight', flight: startShot(state, shooter, 1) }

    // Watch the moment it lands rather than the announcement, which times out.
    let landed = ''
    for (let i = 0; i < 1200 && state.phase.kind === 'flight'; i++) {
      stepMatch(state, TICK)
      if (state.announcement) landed = state.announcement
    }

    // It used to be gathered rather than saved: a spent shot arrived with
    // nothing, the keeper never rolled, and the chance of a goal was exactly
    // zero. Watching that number fall on screen made shooting from range look
    // pointless, and it was. It arrives with `MINIMUM_ARRIVING_SHOT` now, so the
    // keeper has to make the save — and once in a great while does not.
    expect(landed, landed).toContain('saves')
    expect(state.teams.home.score).toBe(0)
    expect(state.ball.carrier).toBe(keeperFor(state, 'away')?.id)
  })
})

describe('while the ball is in the air', () => {
  it('holds every player where the throw left them', () => {
    const { state } = passAcross(60, 60, 'frozen')
    const before = state.players.map((p) => ({ id: p.id, x: p.x, y: p.y }))

    for (let i = 0; i < 20 && state.phase.kind === 'flight'; i++) stepMatch(state, TICK)

    for (const was of before) {
      const now = find(state, was.id)
      expect(Math.hypot(now.x - was.x, now.y - was.y), `${was.id} swam`).toBeLessThan(0.001)
    }
  })

  it('keeps the clock running', () => {
    const { state } = passAcross(60, 60, 'clock')
    const before = state.clock
    for (let i = 0; i < 20 && state.phase.kind === 'flight'; i++) stepMatch(state, TICK)
    expect(state.clock).toBeLessThan(before)
  })
})
