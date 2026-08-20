import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { confineToPool } from './scene-renderer'
import { POOL_RADIUS } from '../core/pitch'

/**
 * The camera has to stay in the water. Outside it you are looking at a sphere
 * hanging in a black void, with the far wall cutting across the frame and play
 * half hidden behind its own pool — which is what following play into a corner
 * used to do.
 */
describe('keeping the camera in the water', () => {
  const limit = POOL_RADIUS

  it('leaves a position that is already inside alone', () => {
    const inside = new Vector3(10, 5, 20)
    const before = inside.clone()
    confineToPool(inside)
    expect(inside.equals(before)).toBe(true)
  })

  it('pulls an outside position back within the pool', () => {
    const outside = new Vector3(POOL_RADIUS * 2, 0, POOL_RADIUS * 2)
    confineToPool(outside)
    expect(outside.length()).toBeLessThan(limit)
  })

  it('keeps the direction it was looking from', () => {
    const outside = new Vector3(90, 40, 85)
    const heading = outside.clone().normalize()
    confineToPool(outside)
    // Projected straight back along its own line, so it comes in closer rather
    // than swinging round to somewhere else entirely.
    expect(outside.clone().normalize().distanceTo(heading)).toBeLessThan(1e-6)
  })

  it('handles the centre without dividing by zero', () => {
    const centre = new Vector3(0, 0, 0)
    confineToPool(centre)
    expect(centre.length()).toBe(0)
  })

  it('holds for a camera chasing play into any corner of the pool', () => {
    for (const x of [-POOL_RADIUS, 0, POOL_RADIUS]) {
      for (const z of [-POOL_RADIUS, 0, POOL_RADIUS]) {
        const position = new Vector3(x, POOL_RADIUS * 0.5, z + POOL_RADIUS * 0.6)
        confineToPool(position)
        expect(position.length(), `corner ${x},${z}`).toBeLessThanOrEqual(limit)
      }
    }
  })
})
