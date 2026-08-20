import type { Vec2 } from '../core/pitch'

/**
 * How the simulation's flat pitch sits in the 3D scene.
 *
 * The simulation is two-dimensional and stays that way: this maps its plane into
 * the world so the scene can be drawn around it. Play occupies the vertical
 * plane facing the camera — goals left and right, up is up — which is the view
 * FFX shows, with the sphere of water built around it rather than the pitch
 * being laid flat like a swimming pool seen from above.
 *
 * Simulation y runs downward, in the screen convention the 2D renderer uses, so
 * it is negated here rather than in every call site.
 */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * JavaScript distinguishes -0 from 0, and negating a zero produces one. Nothing
 * downstream should have to care, so it is normalised here.
 */
const unsigned = (n: number): number => (n === 0 ? 0 : n)

/** A point on the pitch, in scene coordinates. */
export function toScene(point: Vec2, depth = 0): Vec3 {
  return { x: unsigned(point.x), y: unsigned(-point.y), z: depth }
}

/** The inverse, for turning something in the scene back into pitch terms. */
export function fromScene(point: Vec3): Vec2 {
  return { x: unsigned(point.x), y: unsigned(-point.y) }
}

/**
 * Interpolate between two ticks and project, in one step.
 *
 * Every moving body in the scene needs exactly this, and doing it here keeps the
 * renderer from re-deriving the same lerp for players, the ball and the camera.
 */
export function interpolateToScene(
  previous: Vec2,
  current: Vec2,
  alpha: number,
  depth = 0,
): Vec3 {
  return {
    x: unsigned(previous.x + (current.x - previous.x) * alpha),
    y: unsigned(-(previous.y + (current.y - previous.y) * alpha)),
    z: depth,
  }
}
