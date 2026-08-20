import type { Vec2 } from '../core/pitch'

/**
 * How the simulation's flat pitch sits in the 3D scene.
 *
 * The simulation is two-dimensional and stays that way: this maps its plane into
 * the world so the scene can be drawn around it.
 *
 * Play lies flat, on the equator of the sphere: pitch x runs left to right with
 * the goals at either end, and pitch y runs away from and towards the camera.
 * That is what lets a broadcast camera sit low and look across the pool, with
 * the far wall of the sphere rising behind play as a horizon. Standing the pitch
 * up to face the camera instead — the obvious reading of a flat simulation —
 * makes it a wall, and no camera angle rescues that.
 *
 * `y` is therefore elevation, which everything on the pitch shares.
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

/** A point on the pitch, in scene coordinates. `height` lifts it off the plane. */
export function toScene(point: Vec2, height = 0): Vec3 {
  return { x: unsigned(point.x), y: height, z: unsigned(point.y) }
}

/** The inverse, for turning something in the scene back into pitch terms. */
export function fromScene(point: Vec3): Vec2 {
  return { x: unsigned(point.x), y: unsigned(point.z) }
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
  height = 0,
): Vec3 {
  return {
    x: unsigned(previous.x + (current.x - previous.x) * alpha),
    y: height,
    z: unsigned(previous.y + (current.y - previous.y) * alpha),
  }
}
