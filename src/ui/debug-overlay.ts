import type { LoopStats } from '../core/loop'
import { carrierOf, playerById } from '../core/match/queries'
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

    const carrier = carrierOf(state)
    const controlled = playerById(state, state.controlled)

    this.element.textContent = [
      `fps     ${stats.fps.toFixed(0).padStart(3)}`,
      `phase   ${describePhase(state)}`,
      `clock   ${state.clock.toFixed(1)}s  half ${state.half}`,
      `score   ${state.teams.home.score} – ${state.teams.away.score}`,
      `holder  ${carrier ? `${carrier.def.name} (${carrier.team})` : 'loose'}`,
      `EN      ${state.endurance}`,
      `you     ${controlled ? `${controlled.def.name} ${controlled.slot}` : '—'}`,
      '',
      'WASD / arrows to swim',
      'space to stop and look up',
      'tab / q to switch player',
      'number keys to choose in an encounter',
      '~ toggle overlay',
    ].join('\n')
  }
}

function describePhase(state: MatchState): string {
  const { phase } = state
  switch (phase.kind) {
    case 'encounter':
      return `encounter (${phase.encounter.defenders.length} on)`
    case 'flight':
      return `${phase.flight.kind} in flight (${phase.flight.power.toFixed(0)})`
    case 'celebration':
      return `goal: ${phase.scorer}`
    default:
      return phase.kind
  }
}
