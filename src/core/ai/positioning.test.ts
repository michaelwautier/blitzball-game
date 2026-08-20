import { describe, expect, it } from 'vitest'
import { desiredPosition, isChasing } from './positioning'
import { createMatch, stepMatch } from '../match/state'
import type { MatchState, Player } from '../match/types'
import { PLAYER_RADIUS } from '../match/movement'
import { BESAID_AUROCHS, LUCA_GOERS } from '../../data/teams'
import { POOL_RADIUS } from '../pitch'

const newMatch = (seed = 'ai') => createMatch(BESAID_AUROCHS, LUCA_GOERS, seed)

const find = (state: MatchState, id: string): Player => {
  const player = state.players.find((p) => p.id === id)
  if (!player) throw new Error(`no player ${id}`)
  return player
}

describe('off-ball positioning', () => {
  it('never asks anyone to swim outside the pool', () => {
    const state = newMatch('bounds')
    // Sample across the pool, including spots outside it, to exercise clamping.
    for (const bx of [-80, -40, 0, 40, 80]) {
      for (const by of [-80, 0, 80]) {
        state.ball.x = bx
        state.ball.y = by
        for (const player of state.players) {
          const target = desiredPosition(state, player)
          expect(
            Math.hypot(target.x, target.y),
            `${player.def.name} targeted (${bx}, ${by})`,
          ).toBeLessThanOrEqual(POOL_RADIUS - PLAYER_RADIUS + 1e-6)
        }
      }
    }
  })

  it('keeps the keeper on its own goal line', () => {
    const state = newMatch('keeper')
    const keeper = find(state, 'home:keepa')
    const line = desiredPosition(state, keeper).x

    for (const ballY of [-40, 0, 40]) {
      state.ball.y = ballY
      state.ball.x = 30
      const target = desiredPosition(state, keeper)
      expect(target.x).toBe(line)
      expect(target.x).toBeLessThan(0)
    }
  })

  it('has the keeper shuffle towards the ball, not ignore it', () => {
    const state = newMatch('keeper-track')
    const keeper = find(state, 'home:keepa')

    state.ball.y = -20
    const high = desiredPosition(state, keeper).y
    state.ball.y = 20
    const low = desiredPosition(state, keeper).y

    expect(high).toBeLessThan(low)
  })

  it('sends only two outfielders after a loose ball', () => {
    const state = newMatch('chase')
    state.ball.carrier = null
    state.ball.x = 0
    state.ball.y = 0

    for (const team of ['home', 'away'] as const) {
      const chasing = state.players.filter((p) => p.team === team && isChasing(state, p))
      expect(chasing).toHaveLength(2)
    }
  })

  it('never sends the keeper chasing', () => {
    const state = newMatch('keeper-stay')
    state.ball.carrier = null
    state.ball.x = -44
    state.ball.y = 0
    expect(isChasing(state, find(state, 'home:keepa'))).toBe(false)
  })

  it('closes down an opposing carrier but does not chase a teammate', () => {
    const state = newMatch('mark')
    const bickson = find(state, 'away:bickson')
    state.ball.carrier = bickson.id

    const defenders = state.players.filter((p) => p.team === 'home' && isChasing(state, p))
    expect(defenders).toHaveLength(2)

    const teammates = state.players.filter((p) => p.team === 'away' && isChasing(state, p))
    expect(teammates).toHaveLength(0)
  })

  it('marks goal-side of the carrier rather than trailing them', () => {
    const state = newMatch('goal-side')
    const bickson = find(state, 'away:bickson')
    bickson.x = 0
    bickson.y = 0
    state.ball.carrier = bickson.id

    const marker = state.players.find((p) => p.team === 'home' && isChasing(state, p))!
    // Away defends the right goal, so it attacks -x; markers must get in front.
    expect(desiredPosition(state, marker).x).toBeLessThan(bickson.x)
  })

  it('gives the two closing defenders different spots to aim for', () => {
    const state = newMatch('fan-out')
    const bickson = find(state, 'away:bickson')
    bickson.x = 0
    bickson.y = 0
    state.ball.carrier = bickson.id

    const markers = state.players.filter((p) => p.team === 'home' && isChasing(state, p))
    expect(markers).toHaveLength(2)

    const [first, second] = markers.map((p) => desiredPosition(state, p))
    expect(Math.hypot(first!.x - second!.x, first!.y - second!.y)).toBeGreaterThan(PLAYER_RADIUS)
  })

  it('drives an AI carrier towards the goal it is attacking', () => {
    const state = newMatch('drive')
    const bickson = find(state, 'away:bickson')
    state.ball.carrier = bickson.id
    expect(desiredPosition(state, bickson).x).toBeLessThan(bickson.x)

    const tidus = find(state, 'home:tidus')
    state.ball.carrier = tidus.id
    expect(desiredPosition(state, tidus).x).toBeGreaterThan(tidus.x)
  })

  it('pushes supporting attackers upfield when their team has the ball', () => {
    const state = newMatch('support')
    const wakka = find(state, 'home:wakka')
    const tidus = find(state, 'home:tidus')

    state.ball.carrier = 'away:bickson'
    const defending = desiredPosition(state, wakka).x

    state.ball.carrier = tidus.id
    const attacking = desiredPosition(state, wakka).x

    expect(attacking).toBeGreaterThan(defending)
  })

  it('leaves the team in shape rather than collapsing onto the ball', () => {
    const state = newMatch('shape')
    for (let i = 0; i < 600; i++) stepMatch(state, 1 / 60)

    const home = state.players.filter((p) => p.team === 'home')
    const spread = Math.max(...home.map((p) => p.y)) - Math.min(...home.map((p) => p.y))
    expect(spread, 'the side should still be spread across the pool').toBeGreaterThan(10)
  })
})
