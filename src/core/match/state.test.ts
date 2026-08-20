import { describe, expect, it } from 'vitest'
import { createMatch, releaseBall, resetForKickoff, stepMatch } from './state'
import type { MatchInput, MatchState, Player } from './types'
import { carrierOf, playerById } from './queries'
import { PLAYER_RADIUS } from './movement'
import { BESAID_AUROCHS, LUCA_GOERS } from '../../data/teams'
import { BALL_RADIUS, POOL_RADIUS } from '../pitch'

const TICK = 1 / 60

const newMatch = (seed = 'test') => createMatch(BESAID_AUROCHS, LUCA_GOERS, seed)

function run(state: MatchState, ticks: number, input?: MatchInput): void {
  for (let i = 0; i < ticks; i++) stepMatch(state, TICK, input)
}

const positions = (state: MatchState) => state.players.map((p) => ({ x: p.x, y: p.y }))

describe('match setup', () => {
  it('fields six players per side, one per position', () => {
    const state = newMatch()
    for (const team of ['home', 'away'] as const) {
      const side = state.players.filter((p) => p.team === team)
      expect(side).toHaveLength(6)
      expect(new Set(side.map((p) => p.slot)).size).toBe(6)
    }
  })

  it('gives every player a match-unique id', () => {
    const state = newMatch()
    expect(new Set(state.players.map((p) => p.id)).size).toBe(state.players.length)
  })

  it('starts each player on full HP from their stat block', () => {
    const state = newMatch()
    for (const player of state.players) expect(player.hp).toBe(player.def.stats.hp)
  })

  it('has the teams defending opposite goals', () => {
    const state = newMatch()
    expect(state.teams.home.defending).not.toBe(state.teams.away.defending)
  })

  it('starts everyone in their own half with the ball loose at the centre', () => {
    const state = newMatch()
    expect(state.ball.carrier).toBeNull()
    expect({ x: state.ball.x, y: state.ball.y }).toEqual({ x: 0, y: 0 })

    for (const player of state.players) {
      // Home defends the left goal, so its players start at negative x.
      const ownHalf = player.team === 'home' ? player.x < 0 : player.x > 0
      expect(ownHalf, `${player.def.name} should start in their own half`).toBe(true)
    }
  })

  it('hands control to a home outfielder, never the keeper', () => {
    const state = newMatch()
    const controlled = playerById(state, state.controlled)
    expect(controlled?.team).toBe('home')
    expect(controlled?.slot).not.toBe('GK')
  })
})

describe('match simulation', () => {
  it('advances the clock by exactly the elapsed ticks', () => {
    const state = newMatch()
    run(state, 600)
    expect(state.elapsed).toBeCloseTo(10, 6)
  })

  it('keeps every player inside the pool', () => {
    const state = newMatch('containment')
    const chargeRight: MatchInput = { move: { x: 1, y: 0.4 } }
    for (let i = 0; i < 3000; i++) {
      stepMatch(state, TICK, chargeRight)
      for (const player of state.players) {
        expect(
          Math.hypot(player.x, player.y),
          `${player.def.name} left the pool`,
        ).toBeLessThanOrEqual(POOL_RADIUS - PLAYER_RADIUS + 1e-6)
      }
    }
  })

  it('keeps a loose ball inside the pool', () => {
    const state = newMatch('loose')
    for (let i = 0; i < 2000; i++) {
      stepMatch(state, TICK)
      if (state.ball.carrier === null) {
        expect(Math.hypot(state.ball.x, state.ball.y)).toBeLessThanOrEqual(
          POOL_RADIUS - BALL_RADIUS + 1e-6,
        )
      }
    }
  })

  it('keeps a carried ball inside the pool, even pinned against the wall', () => {
    const state = newMatch('pinned')
    // Drive at the wall for long enough to be held there with the ball out front.
    for (let i = 0; i < 1500; i++) {
      stepMatch(state, TICK, { move: { x: 1, y: 0 } })
      expect(Math.hypot(state.ball.x, state.ball.y)).toBeLessThanOrEqual(
        POOL_RADIUS - BALL_RADIUS + 1e-6,
      )
    }
  })

  it('never leaves two players occupying the same space', () => {
    const state = newMatch('crowding')
    const minimum = PLAYER_RADIUS * 2

    for (let i = 0; i < 1500; i++) {
      stepMatch(state, TICK, { move: { x: 1, y: 0 } })
      for (let a = 0; a < state.players.length; a++) {
        for (let b = a + 1; b < state.players.length; b++) {
          const one = state.players[a]!
          const two = state.players[b]!
          const gap = Math.hypot(one.x - two.x, one.y - two.y)
          // Allow a little tolerance: the wall clamp can squeeze a crowd slightly.
          expect(gap, `${one.def.name} and ${two.def.name} overlap`).toBeGreaterThan(minimum * 0.6)
        }
      }
    }
  })

  it('is reproducible from a seed', () => {
    const a = newMatch('besaid')
    const b = newMatch('besaid')
    run(a, 1200)
    run(b, 1200)
    expect(positions(a)).toEqual(positions(b))
    expect(a.ball.carrier).toBe(b.ball.carrier)
  })

  it('diverges between seeds', () => {
    const a = newMatch('besaid')
    const b = newMatch('luca')
    run(a, 1200)
    run(b, 1200)
    expect(positions(a)).not.toEqual(positions(b))
  })

  it('someone collects the loose kickoff within a few seconds', () => {
    const state = newMatch('kickoff')
    run(state, 300)
    expect(state.ball.carrier).not.toBeNull()
  })
})

describe('possession', () => {
  /** Run until someone has the ball, so possession behaviour can be tested. */
  function runToPossession(state: MatchState): Player {
    for (let i = 0; i < 600 && state.ball.carrier === null; i++) stepMatch(state, TICK)
    const carrier = carrierOf(state)
    if (!carrier) throw new Error('nobody took possession')
    return carrier
  }

  it('keeps the ball glued to whoever is carrying it', () => {
    const state = newMatch('carry')
    runToPossession(state)

    // Possession legitimately changes hands via encounters, so this tracks the
    // current carrier rather than assuming it is still the original one.
    for (let i = 0; i < 600; i++) {
      stepMatch(state, TICK, { move: { x: 1, y: 0 } })
      const held = carrierOf(state)
      if (!held) continue
      expect(
        Math.hypot(state.ball.x - held.x, state.ball.y - held.y),
        `ball drifted from ${held.def.name}`,
      ).toBeLessThan(PLAYER_RADIUS + BALL_RADIUS + 1.5)
    }
  })

  it('gives the user the ball carrier when their team wins it', () => {
    const state = newMatch('control')
    const carrier = runToPossession(state)
    if (carrier.team === 'home') expect(state.controlled).toBe(carrier.id)
    else expect(state.controlled).not.toBe(carrier.id)
  })

  it('does not let the carrier reclaim a released ball immediately', () => {
    const state = newMatch('release')
    runToPossession(state)

    releaseBall(state, 0, 0)
    expect(state.ball.carrier).toBeNull()

    // Within the cooldown the ball stays loose even with players on top of it.
    run(state, 10)
    expect(state.ball.carrier).toBeNull()
  })

  it('allows collection again once the cooldown expires', () => {
    const state = newMatch('recollect')
    runToPossession(state)
    releaseBall(state, 0, 0)
    run(state, 120)
    expect(state.ball.carrier).not.toBeNull()
  })
})

describe('kickoff reset', () => {
  it('returns players home and frees the ball', () => {
    const state = newMatch('reset')
    run(state, 600, { move: { x: 1, y: 1 } })

    resetForKickoff(state)

    expect(state.ball.carrier).toBeNull()
    expect({ x: state.ball.x, y: state.ball.y }).toEqual({ x: 0, y: 0 })
    for (const player of state.players) {
      expect({ x: player.vx, y: player.vy }).toEqual({ x: 0, y: 0 })
      const ownHalf = player.team === 'home' ? player.x < 0 : player.x > 0
      expect(ownHalf).toBe(true)
    }
  })

  it('does not rewind the clock', () => {
    const state = newMatch('clock')
    run(state, 600)
    const before = state.elapsed
    resetForKickoff(state)
    expect(state.elapsed).toBe(before)
  })
})
