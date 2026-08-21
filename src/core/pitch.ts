/**
 * Sphere pool geometry, in world units (roughly metres).
 *
 * The pool is a sphere; the game is played on a top-down projection of it, so
 * the playable area is a circle centred on the origin. Teams attack left (-x)
 * and right (+x); the halfway line is the vertical diameter at x = 0.
 */

/**
 * Radius of the playable circle.
 *
 * Everything below is expressed as a fraction of it, and the speed and decay
 * constants elsewhere are scaled to match, so this is the one number to change
 * to give players more or less room. Bodies deliberately do *not* scale with it:
 * that is what turns a bigger pool into more space rather than the same game
 * drawn larger.
 *
 * Raised from 110 for exactly that reason. It is not free, despite everything
 * scaling: the goal mouth and the bodies stay the size they were, so the same
 * shot has a relatively smaller target and the pool takes more crossing per
 * point of pass range. Goals fell from 2.40 a match to 2.14 on the strength of
 * it, and `SHOT_DECAY_PER_UNIT` was re-tuned to bring them back — see the note
 * there before moving this again, because the two have to be measured together.
 *
 * The camera stand-off in `scene-renderer.ts` is the other half of the change:
 * it scales with this, so enlarging the pool alone walks the camera away from
 * players who have not grown.
 *
 * Raising this is now a real lever on how long the pool takes to cross, which it
 * was not before: swim speed scaled with it exactly, so every size crossed in
 * the same eight seconds. See `SWIM_SCALE`. At its current half-power, doubling
 * the radius makes crossing take about 1.4 times as long.
 */
export const POOL_RADIUS = 150

/** Distance from the origin to each goal line. Sits just inside the boundary. */
export const GOAL_X = POOL_RADIUS * 0.92

/** Half-height of the goal mouth, measured along y from the centre. */
export const GOAL_HALF_HEIGHT = 7

/** Radius of the centre circle drawn at kickoff. */
export const CENTRE_CIRCLE_RADIUS = POOL_RADIUS * 0.16

export const BALL_RADIUS = 1.1

/** Which direction a team attacks. `left` defends the -x goal, and vice versa. */
export type Side = 'left' | 'right'

export interface Vec2 {
  x: number
  y: number
}

export function goalLineX(side: Side): number {
  return side === 'left' ? -GOAL_X : GOAL_X
}

export function distanceFromCentre(p: Vec2): number {
  return Math.hypot(p.x, p.y)
}

export function isInsidePool(p: Vec2, radius = 0): boolean {
  return distanceFromCentre(p) <= POOL_RADIUS - radius
}

/** Nearest point inside the pool boundary, keeping `radius` clearance. */
export function clampToPool(p: Vec2, radius = 0): Vec2 {
  const limit = POOL_RADIUS - radius
  const d = distanceFromCentre(p)
  if (d <= limit || d === 0) return { x: p.x, y: p.y }
  const k = limit / d
  return { x: p.x * k, y: p.y * k }
}

/** Whether a point lies within the mouth of the given side's goal. */
export function isInGoalMouth(p: Vec2, side: Side): boolean {
  if (Math.abs(p.y) > GOAL_HALF_HEIGHT) return false
  return side === 'left' ? p.x <= -GOAL_X : p.x >= GOAL_X
}
