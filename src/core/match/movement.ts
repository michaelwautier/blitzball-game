import { POOL_RADIUS, clampToPool, type Vec2 } from '../pitch'

/**
 * The pool size the speed and decay constants were tuned against.
 *
 * Distances scale with the pool so that enlarging it gives players room without
 * silently retuning the game: a throw across the same fraction of the pool costs
 * the same, and crossing it still takes the same few seconds.
 */
export const REFERENCE_POOL_RADIUS = 50

export const PLAYER_RADIUS = 2.2

/** How quickly velocity converges on the desired velocity, per second. */
const ACCELERATION = 9

/** Distance within which a player eases off rather than overshooting the target. */
export const ARRIVE_RADIUS = 4

/** Anything with a position, a velocity, and a record of where it was last tick. */
export interface Movable extends Vec2 {
  prevX: number
  prevY: number
  vx: number
  vy: number
}

/**
 * Top swim speed in world units per second, derived from SP.
 *
 * FFX's speed stat sits in the fifties to eighties rather than single figures,
 * so the mapping is scaled to put a typical player around twelve units a second
 * — roughly four seconds to cross the pool.
 */
export function maxSpeed(sp: number): number {
  return (4 + sp * 0.14) * (POOL_RADIUS / REFERENCE_POOL_RADIUS)
}

/** Carrying the ball costs a little pace. */
export const CARRY_SPEED_FACTOR = 0.88

/**
 * Point the previous position at the current one.
 *
 * Called at the start of a tick, this snapshots where something was so the
 * renderer can interpolate across the movement that follows. Called when nothing
 * is going to move — a frozen phase, or straight after a position is set
 * directly rather than swum to — it collapses the gap instead, which is what
 * stops the renderer interpolating across a stale position.
 */
export function recordPrevious(m: Movable): void {
  m.prevX = m.x
  m.prevY = m.y
}

/**
 * Ease `m`'s velocity towards `desired` and integrate, keeping it in the pool.
 * Velocity is zeroed on the axis that hits the wall so players slide along the
 * boundary instead of sticking to it.
 */
function accelerateAndMove(m: Movable, desiredVx: number, desiredVy: number, dt: number): void {
  const blend = Math.min(1, ACCELERATION * dt)
  m.vx += (desiredVx - m.vx) * blend
  m.vy += (desiredVy - m.vy) * blend

  m.x += m.vx * dt
  m.y += m.vy * dt

  const clamped = clampToPool(m, PLAYER_RADIUS)
  if (clamped.x !== m.x || clamped.y !== m.y) {
    // Project the velocity onto the wall's tangent so motion continues along it.
    const nx = m.x === 0 && m.y === 0 ? 0 : m.x / Math.hypot(m.x, m.y)
    const ny = m.x === 0 && m.y === 0 ? 0 : m.y / Math.hypot(m.x, m.y)
    const into = m.vx * nx + m.vy * ny
    if (into > 0) {
      m.vx -= into * nx
      m.vy -= into * ny
    }
    m.x = clamped.x
    m.y = clamped.y
  }
}

/** Swim towards `target`, easing off on arrival. */
export function steerTowards(m: Movable, target: Vec2, speed: number, dt: number): void {
  const dx = target.x - m.x
  const dy = target.y - m.y
  const distance = Math.hypot(dx, dy)

  if (distance < 0.01) {
    accelerateAndMove(m, 0, 0, dt)
    return
  }

  const throttle = Math.min(1, distance / ARRIVE_RADIUS)
  const scale = (speed * throttle) / distance
  accelerateAndMove(m, dx * scale, dy * scale, dt)
}

/**
 * Swim in a commanded direction. `direction` need not be normalised; magnitudes
 * above 1 are clamped so diagonal input is not faster than cardinal input.
 */
export function steerWithIntent(m: Movable, direction: Vec2, speed: number, dt: number): void {
  const magnitude = Math.hypot(direction.x, direction.y)
  if (magnitude < 0.001) {
    accelerateAndMove(m, 0, 0, dt)
    return
  }
  const scale = (speed * Math.min(1, magnitude)) / magnitude
  accelerateAndMove(m, direction.x * scale, direction.y * scale, dt)
}
