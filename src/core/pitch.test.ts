import { describe, expect, it } from 'vitest'
import {
  clampToPool,
  goalLineX,
  GOAL_HALF_HEIGHT,
  GOAL_X,
  isInGoalMouth,
  isInsidePool,
  POOL_RADIUS,
} from './pitch'

describe('pitch geometry', () => {
  it('places the goal lines inside the pool boundary', () => {
    expect(goalLineX('left')).toBe(-GOAL_X)
    expect(goalLineX('right')).toBe(GOAL_X)
    // The corners of each goal mouth must sit within the circular pool.
    expect(Math.hypot(GOAL_X, GOAL_HALF_HEIGHT)).toBeLessThan(POOL_RADIUS)
  })

  it('detects points inside and outside the pool', () => {
    expect(isInsidePool({ x: 0, y: 0 })).toBe(true)
    expect(isInsidePool({ x: POOL_RADIUS, y: 0 })).toBe(true)
    expect(isInsidePool({ x: POOL_RADIUS + 0.1, y: 0 })).toBe(false)
    // A radius argument demands clearance from the wall.
    expect(isInsidePool({ x: POOL_RADIUS, y: 0 }, 2)).toBe(false)
  })

  it('leaves interior points untouched when clamping', () => {
    expect(clampToPool({ x: 3, y: -4 })).toEqual({ x: 3, y: -4 })
  })

  it('pulls exterior points back onto the boundary along the same heading', () => {
    const clamped = clampToPool({ x: 120, y: 0 }, 2)
    expect(clamped.x).toBeCloseTo(POOL_RADIUS - 2, 6)
    expect(clamped.y).toBeCloseTo(0, 6)

    const diagonal = clampToPool({ x: 100, y: 100 })
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(POOL_RADIUS, 6)
    expect(diagonal.x).toBeCloseTo(diagonal.y, 6)
  })

  it('handles the centre point without dividing by zero', () => {
    expect(clampToPool({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
  })

  it('recognises a ball in the goal mouth', () => {
    expect(isInGoalMouth({ x: -GOAL_X, y: 0 }, 'left')).toBe(true)
    expect(isInGoalMouth({ x: -GOAL_X - 2, y: 3 }, 'left')).toBe(true)
    expect(isInGoalMouth({ x: GOAL_X, y: 0 }, 'right')).toBe(true)
  })

  it('rejects shots wide of the posts or short of the line', () => {
    expect(isInGoalMouth({ x: -GOAL_X, y: GOAL_HALF_HEIGHT + 0.5 }, 'left')).toBe(false)
    expect(isInGoalMouth({ x: -GOAL_X + 1, y: 0 }, 'left')).toBe(false)
    // A ball deep in one goal is not in the other.
    expect(isInGoalMouth({ x: -GOAL_X, y: 0 }, 'right')).toBe(false)
  })
})
