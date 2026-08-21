import { describe, expect, it } from 'vitest'
import { edgeMarker } from './off-screen'

/**
 * The marker is the only thing telling you where play is when the camera cannot
 * show you, so pointing the wrong way is worse than not being there at all.
 */
describe('marking something off screen', () => {
  it('says nothing while it is in view', () => {
    expect(edgeMarker(0, 0, false)).toBeNull()
    expect(edgeMarker(0.5, -0.5, false)).toBeNull()
  })

  it('appears once it leaves the frame', () => {
    expect(edgeMarker(1.4, 0, false)).not.toBeNull()
    expect(edgeMarker(0, -2, false)).not.toBeNull()
  })

  it('rides the edge on the true bearing rather than snapping to a corner', () => {
    // Far off to the right and slightly up: it belongs on the right-hand edge,
    // above the middle, not in the top-right corner.
    const marker = edgeMarker(4, 1, false)!
    expect(marker.x).toBeCloseTo(1 - 0.06 / 2, 5)
    expect(marker.y).toBeGreaterThan(0.3)
    expect(marker.y).toBeLessThan(0.5)
  })

  it('points where the thing actually is', () => {
    // Screen angles: 0 is right, and y grows downwards, so up is negative.
    // Compared as directions, since -π and π are the same way round.
    const points = (marker: { angle: number }, at: number) =>
      Math.abs(Math.atan2(Math.sin(marker.angle - at), Math.cos(marker.angle - at)))

    expect(points(edgeMarker(3, 0, false)!, 0)).toBeLessThan(1e-5)
    expect(points(edgeMarker(-3, 0, false)!, Math.PI)).toBeLessThan(1e-5)
    expect(points(edgeMarker(0, 3, false)!, -Math.PI / 2)).toBeLessThan(1e-5)
    expect(points(edgeMarker(0, -3, false)!, Math.PI / 2)).toBeLessThan(1e-5)
  })

  it('turns a point behind the camera round the right way', () => {
    // A perspective projection mirrors what is behind it through the origin, so
    // something behind and to your left comes back as in front and to the right.
    // Read naively it would be called visible and pointed at backwards.
    const marker = edgeMarker(0.3, 0, true)!
    expect(marker.x).toBeLessThan(0.5)
    expect(Math.abs(marker.angle)).toBeCloseTo(Math.PI, 5)
  })

  it('sends a marker directly behind you downwards rather than nowhere', () => {
    // Dead centre and behind: the projection has no bearing to offer at all.
    const marker = edgeMarker(0, 0, true)!
    expect(marker.x).toBeCloseTo(0.5, 5)
    expect(marker.y).toBeGreaterThan(0.9)
  })

  it('keeps clear of the very edge, so the marker is not half cut off', () => {
    for (const [x, y] of [[9, 0], [0, 9], [-9, -9], [3, -7]] as const) {
      const marker = edgeMarker(x, y, false)!
      expect(Math.min(marker.x, marker.y)).toBeGreaterThanOrEqual(0.02)
      expect(Math.max(marker.x, marker.y)).toBeLessThanOrEqual(0.98)
    }
  })
})
