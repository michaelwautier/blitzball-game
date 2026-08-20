/**
 * Fixed-timestep game loop with interpolated rendering.
 *
 * The simulation always advances in whole ticks of `TICK_SECONDS`, independent
 * of display refresh rate, so behaviour is identical on a 60Hz and a 144Hz
 * screen and is reproducible headlessly. Rendering receives `alpha`, the
 * fraction of the way to the next tick, so drawing can interpolate between the
 * previous and current simulation state and stay smooth.
 */

export const TICK_RATE = 60
export const TICK_SECONDS = 1 / TICK_RATE

/**
 * Longest real time a single frame may advance the simulation. Without this,
 * a backgrounded tab returning after 30s would try to catch up in one frame and
 * lock the page up ("spiral of death"); instead we drop the missed time.
 */
const MAX_FRAME_SECONDS = 0.25

export interface LoopCallbacks {
  /** Advance the simulation by exactly one tick. */
  update: (dt: number) => void
  /** Draw. `alpha` is in [0, 1) between the previous and current tick. */
  render: (alpha: number) => void
}

export interface LoopStats {
  /** Smoothed frames per second. */
  fps: number
  /** Simulation ticks executed in the last frame. */
  ticksLastFrame: number
  /** Total ticks since the loop started. */
  totalTicks: number
}

export interface Loop {
  start: () => void
  stop: () => void
  readonly stats: LoopStats
}

export function createLoop({ update, render }: LoopCallbacks): Loop {
  let rafId: number | null = null
  let lastTime = 0
  let accumulator = 0

  const stats: LoopStats = { fps: 0, ticksLastFrame: 0, totalTicks: 0 }

  const frame = (now: number) => {
    rafId = requestAnimationFrame(frame)

    const elapsed = Math.min((now - lastTime) / 1000, MAX_FRAME_SECONDS)
    lastTime = now

    if (elapsed > 0) {
      // Exponential smoothing keeps the debug readout from flickering.
      stats.fps += (1 / elapsed - stats.fps) * 0.1
    }

    accumulator += elapsed
    let ticks = 0
    while (accumulator >= TICK_SECONDS) {
      update(TICK_SECONDS)
      accumulator -= TICK_SECONDS
      ticks++
    }
    stats.ticksLastFrame = ticks
    stats.totalTicks += ticks

    render(accumulator / TICK_SECONDS)
  }

  return {
    start() {
      if (rafId !== null) return
      lastTime = performance.now()
      accumulator = 0
      rafId = requestAnimationFrame(frame)
    },
    stop() {
      if (rafId === null) return
      cancelAnimationFrame(rafId)
      rafId = null
    },
    stats,
  }
}
