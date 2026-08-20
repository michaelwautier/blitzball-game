import { describe, expect, it } from 'vitest'
import { fromScene, interpolateToScene, toScene } from './projection'
import { GOAL_X, POOL_RADIUS } from '../core/pitch'

describe('projecting the pitch into the scene', () => {
  it('leaves the centre at the origin', () => {
    expect(toScene({ x: 0, y: 0 })).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('keeps the goals left and right, as the camera sees them', () => {
    expect(toScene({ x: GOAL_X, y: 0 }).x).toBeGreaterThan(0)
    expect(toScene({ x: -GOAL_X, y: 0 }).x).toBeLessThan(0)
  })

  it('runs the pitch away from the camera rather than up a wall', () => {
    // Pitch y becomes depth into the scene, not height.
    expect(toScene({ x: 0, y: 10 }).z).toBe(10)
    expect(toScene({ x: 0, y: -10 }).z).toBe(-10)
  })

  it('lays play flat, so everything on the pitch shares an elevation', () => {
    expect(toScene({ x: 20, y: 20 }).y).toBe(0)
    expect(toScene({ x: -30, y: 5 }).y).toBe(0)
  })

  it('accepts a height for anything lifted off the plane', () => {
    expect(toScene({ x: 0, y: 0 }, 3).y).toBe(3)
  })

  it('round-trips back to pitch coordinates', () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 12, y: -7 },
      { x: -POOL_RADIUS, y: POOL_RADIUS },
    ]) {
      expect(fromScene(toScene(point))).toEqual(point)
    }
  })
})

describe('interpolating into the scene', () => {
  const previous = { x: 0, y: 0 }
  const current = { x: 10, y: 20 }

  it('sits on the previous position at the start of a tick', () => {
    expect(interpolateToScene(previous, current, 0)).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('sits on the current position at the end of one', () => {
    expect(interpolateToScene(previous, current, 1)).toEqual({ x: 10, y: 0, z: 20 })
  })

  it('sits halfway in between', () => {
    expect(interpolateToScene(previous, current, 0.5)).toEqual({ x: 5, y: 0, z: 10 })
  })

  it('agrees with projecting the endpoints directly', () => {
    expect(interpolateToScene(previous, current, 1)).toEqual(toScene(current))
    expect(interpolateToScene(previous, current, 0)).toEqual(toScene(previous))
  })

  it('draws a body that has not moved exactly where it is', () => {
    // The interpolation fix in #10 relies on this being a no-op.
    const still = { x: 7, y: -3 }
    for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
      expect(interpolateToScene(still, still, alpha)).toEqual(toScene(still))
    }
  })
})
