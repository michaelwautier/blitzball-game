import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { confineToPool, keepFocusInView } from './scene-renderer'
import { POOL_RADIUS } from '../core/pitch'

/**
 * The camera has two hard requirements that fight each other: it must stay
 * inside the water, because outside the sphere there is nothing to render, and
 * it must have the player it is following in front of it. At the edges of the
 * pool the obvious way to satisfy the second — back further away — violates the
 * first, which is how a player at the bottom of the pool went missing entirely.
 */
const at = (x: number, z: number) => new THREE.Vector3(x, POOL_RADIUS * 0.3, z)

describe('keeping the followed player on screen', () => {
  it('leaves a camera that is already well behind them alone', () => {
    const camera = at(0, 60)
    const before = camera.clone()
    keepFocusInView(camera, { x: 0, z: 0 })
    expect(camera).toEqual(before)
  })

  it('backs off a camera sitting on top of them', () => {
    const focus = { x: 0, z: 90 }
    const camera = at(0, 91)

    keepFocusInView(camera, focus)
    const gap = Math.hypot(camera.x - focus.x, camera.z - focus.z)
    expect(gap).toBeGreaterThan(POOL_RADIUS * 0.3)
  })

  it('retreats towards the middle rather than out of the water', () => {
    // The case from the bug: a player at the bottom edge. Backing straight off
    // in +z would leave the pool, so it pulls in towards the centre instead.
    const focus = { x: 0, z: POOL_RADIUS * 0.94 }
    const camera = at(0, POOL_RADIUS * 0.95)

    keepFocusInView(camera, focus)

    expect(camera.length(), 'the camera left the water').toBeLessThanOrEqual(POOL_RADIUS)
    expect(camera.z, 'it did not move towards the middle').toBeLessThan(focus.z)
  })

  it('works at every edge of the pool, not just the near one', () => {
    const edge = POOL_RADIUS * 0.93
    for (const focus of [
      { x: 0, z: edge },
      { x: 0, z: -edge },
      { x: edge, z: 0 },
      { x: -edge, z: 0 },
      { x: edge * 0.7, z: edge * 0.7 },
    ]) {
      const camera = at(focus.x, focus.z)
      keepFocusInView(camera, focus)

      const gap = Math.hypot(camera.x - focus.x, camera.z - focus.z)
      expect(gap, `no view of a player at ${focus.x},${focus.z}`).toBeGreaterThan(
        POOL_RADIUS * 0.3,
      )
      expect(camera.length(), `left the water at ${focus.x},${focus.z}`).toBeLessThanOrEqual(
        POOL_RADIUS,
      )
    }
  })

  it('does not divide by zero for a player on the centre spot', () => {
    const camera = at(0, 0)
    expect(() => keepFocusInView(camera, { x: 0, z: 0 })).not.toThrow()
    expect(Number.isFinite(camera.x) && Number.isFinite(camera.z)).toBe(true)
  })

  it('keeps the height it was given', () => {
    const camera = at(0, POOL_RADIUS * 0.95)
    keepFocusInView(camera, { x: 0, z: POOL_RADIUS * 0.94 })
    expect(camera.y).toBe(POOL_RADIUS * 0.3)
  })
})

describe('confining the camera to the water', () => {
  it('leaves a position inside alone', () => {
    const inside = at(10, 10)
    const before = inside.clone()
    confineToPool(inside)
    expect(inside).toEqual(before)
  })

  it('pulls an outside position back in', () => {
    const outside = new THREE.Vector3(POOL_RADIUS * 2, 0, 0)
    confineToPool(outside)
    expect(outside.length()).toBeLessThanOrEqual(POOL_RADIUS)
  })
})
