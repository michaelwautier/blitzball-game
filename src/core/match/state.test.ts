import { describe, expect, it } from 'vitest'
import { createMatchState, stepMatch, type MatchState } from './state'
import { BALL_RADIUS, POOL_RADIUS } from '../pitch'

const TICK = 1 / 60

function run(state: MatchState, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepMatch(state, TICK)
}

describe('match simulation', () => {
  it('advances the clock by exactly the elapsed ticks', () => {
    const state = createMatchState('kickoff')
    run(state, 600)
    expect(state.elapsed).toBeCloseTo(10, 6)
  })

  it('keeps the ball inside the pool', () => {
    const state = createMatchState('containment')
    for (let i = 0; i < 20_000; i++) {
      stepMatch(state, TICK)
      expect(Math.hypot(state.ball.x, state.ball.y)).toBeLessThanOrEqual(
        POOL_RADIUS - BALL_RADIUS + 1e-9,
      )
    }
  })

  it('is reproducible from a seed', () => {
    const a = createMatchState('besaid')
    const b = createMatchState('besaid')
    run(a, 5000)
    run(b, 5000)
    expect({ x: a.ball.x, y: a.ball.y }).toEqual({ x: b.ball.x, y: b.ball.y })
  })

  it('diverges between seeds', () => {
    const a = createMatchState('besaid')
    const b = createMatchState('luca')
    run(a, 5000)
    run(b, 5000)
    expect({ x: a.ball.x, y: a.ball.y }).not.toEqual({ x: b.ball.x, y: b.ball.y })
  })

  it('conserves ball speed through bounces', () => {
    const state = createMatchState('speed')
    const initial = Math.hypot(state.ball.vx, state.ball.vy)
    run(state, 5000)
    expect(Math.hypot(state.ball.vx, state.ball.vy)).toBeCloseTo(initial, 6)
  })

  it('records the previous position for interpolation', () => {
    const state = createMatchState('interp')
    stepMatch(state, TICK)
    expect({ x: state.ball.prevX, y: state.ball.prevY }).toEqual({ x: 0, y: 0 })
    stepMatch(state, TICK)
    expect(state.ball.prevX).not.toBe(0)
  })
})
