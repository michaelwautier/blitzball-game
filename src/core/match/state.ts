import { Rng } from '../rng'
import { BALL_RADIUS, POOL_RADIUS, type Vec2 } from '../pitch'

/**
 * Phase 0 placeholder simulation: a single ball loose in the pool.
 *
 * Its only job is to prove out the shape the real match engine will take — a
 * pure, seeded, fixed-timestep `step` over plain state — and to give the
 * renderer something moving to interpolate. Phase 1 replaces the contents with
 * the actual match state machine (players, possession, encounters, clock)
 * while keeping this module's contract.
 */

export interface Ball extends Vec2 {
  /** Position at the previous tick, used to interpolate between renders. */
  prevX: number
  prevY: number
  vx: number
  vy: number
}

export interface MatchState {
  /** Simulated seconds since kickoff. */
  elapsed: number
  ball: Ball
  rng: Rng
}

export function createMatchState(seed: number | string): MatchState {
  const rng = typeof seed === 'string' ? Rng.fromString(seed) : new Rng(seed)
  const heading = rng.range(0, Math.PI * 2)
  const speed = 22

  return {
    elapsed: 0,
    rng,
    ball: {
      x: 0,
      y: 0,
      prevX: 0,
      prevY: 0,
      vx: Math.cos(heading) * speed,
      vy: Math.sin(heading) * speed,
    },
  }
}

export function stepMatch(state: MatchState, dt: number): void {
  const { ball } = state
  state.elapsed += dt

  ball.prevX = ball.x
  ball.prevY = ball.y
  ball.x += ball.vx * dt
  ball.y += ball.vy * dt

  bounceOffBoundary(ball, state.rng)
}

/** Reflect the ball off the pool wall, with a little scatter so it never loops forever. */
function bounceOffBoundary(ball: Ball, rng: Rng): void {
  const limit = POOL_RADIUS - BALL_RADIUS
  const dist = Math.hypot(ball.x, ball.y)
  if (dist <= limit || dist === 0) return

  const nx = ball.x / dist
  const ny = ball.y / dist

  // Place the ball back against the wall so it cannot tunnel through.
  ball.x = nx * limit
  ball.y = ny * limit

  const dot = ball.vx * nx + ball.vy * ny
  let vx = ball.vx - 2 * dot * nx
  let vy = ball.vy - 2 * dot * ny

  const scatter = rng.range(-0.12, 0.12)
  const cos = Math.cos(scatter)
  const sin = Math.sin(scatter)
  ball.vx = vx * cos - vy * sin
  ball.vy = vx * sin + vy * cos
}
