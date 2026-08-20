import { describe, expect, it } from 'vitest'
import {
  allAnchorsInsidePool,
  anchorFor,
  attackDirection,
  keeperPosition,
  kickoffPosition,
} from './formation'
import { POSITION_KEYS } from '../../data/types'
import { GOAL_HALF_HEIGHT, POOL_RADIUS } from '../pitch'
import { PLAYER_RADIUS } from './movement'

describe('formation', () => {
  it('keeps every anchor inside the pool', () => {
    expect(allAnchorsInsidePool()).toBe(true)
  })

  it('mirrors anchors across x for the opposite side', () => {
    for (const slot of POSITION_KEYS) {
      const left = anchorFor(slot, 'left')
      const right = anchorFor(slot, 'right')
      expect(right.x).toBe(-left.x)
      expect(right.y).toBe(left.y)
    }
  })

  it('returns copies, so callers cannot corrupt the table', () => {
    const first = anchorFor('MF', 'left')
    first.x = 999
    expect(anchorFor('MF', 'left').x).not.toBe(999)
  })

  it('has each side attacking the goal it does not defend', () => {
    expect(attackDirection('left')).toBe(1)
    expect(attackDirection('right')).toBe(-1)
  })

  it('puts the keeper in front of the goal it defends', () => {
    expect(anchorFor('GK', 'left').x).toBeLessThan(0)
    expect(anchorFor('GK', 'right').x).toBeGreaterThan(0)
  })

  it('starts everyone in their own half at kickoff', () => {
    for (const slot of POSITION_KEYS) {
      expect(kickoffPosition(slot, 'left').x, `${slot} defending left`).toBeLessThan(0)
      expect(kickoffPosition(slot, 'right').x, `${slot} defending right`).toBeGreaterThan(0)
    }
  })

  it('keeps kickoff positions inside the pool', () => {
    for (const slot of POSITION_KEYS) {
      for (const side of ['left', 'right'] as const) {
        const spot = kickoffPosition(slot, side)
        expect(Math.hypot(spot.x, spot.y)).toBeLessThanOrEqual(POOL_RADIUS - PLAYER_RADIUS + 1e-9)
      }
    }
  })

  it('has the keeper track the ball but never stray past the posts', () => {
    const line = anchorFor('GK', 'left').x
    expect(keeperPosition('left', 3).y).toBe(3)
    expect(keeperPosition('left', 3).x).toBe(line)

    // A ball out near the wall must not drag the keeper off the goal mouth.
    expect(Math.abs(keeperPosition('left', POOL_RADIUS).y)).toBeLessThanOrEqual(
      GOAL_HALF_HEIGHT + 2,
    )
    expect(Math.abs(keeperPosition('left', -POOL_RADIUS).y)).toBeLessThanOrEqual(
      GOAL_HALF_HEIGHT + 2,
    )
  })
})
