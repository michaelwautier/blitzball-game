import type { LoopStats } from '../core/loop'
import type { MatchState } from '../core/match/state'

/** Corner readout for loop health and simulation state. Toggled with `~`. */
export class DebugOverlay {
  private visible = true

  constructor(private readonly element: HTMLElement) {
    this.element.hidden = !this.visible
  }

  toggle(): void {
    this.visible = !this.visible
    this.element.hidden = !this.visible
  }

  update(stats: LoopStats, state: MatchState): void {
    if (!this.visible) return
    const { ball } = state
    this.element.textContent = [
      `fps    ${stats.fps.toFixed(0).padStart(3)}`,
      `ticks  ${stats.ticksLastFrame} this frame / ${stats.totalTicks} total`,
      `clock  ${state.elapsed.toFixed(2)}s`,
      `ball   ${ball.x.toFixed(1)}, ${ball.y.toFixed(1)}`,
      `speed  ${Math.hypot(ball.vx, ball.vy).toFixed(1)} u/s`,
      '',
      '~ toggle overlay',
    ].join('\n')
  }
}
