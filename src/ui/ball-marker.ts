import { USER_TEAM, type MatchState } from '../core/match/types'
import { distanceBetween, keeperFor, opponentOf, playerById } from '../core/match/queries'
import { powerLeft } from '../core/match/flight'
import { expectedCatch } from '../core/encounter/formulas'
import { effectiveStat } from '../core/match/stats'
import type { BallView } from '../render/scene-renderer'

/**
 * What the ball is doing, drawn on top of the scene.
 *
 * Two jobs, because they are the same job: saying where the ball is and what it
 * is carrying. Off screen it is an arrow at the edge of the frame with the
 * distance you would have to swim. In flight it is the power the throw still
 * has, falling as it travels.
 *
 * That second one is the whole decision made visible. A throw bleeds power over
 * the distance it covers and is settled on what is left when it lands — so
 * whether a pass will be held, or a shot will beat the keeper, is decided by a
 * number that until now existed only inside the engine. Watching it come down
 * is watching the outcome being decided.
 */
export class BallMarker {
  private lastText = ''
  private lastTone = ''

  constructor(private readonly element: HTMLElement) {
    this.element.append(this.arrow, this.label)
  }

  private readonly arrow = span('marker-arrow')
  private readonly label = span('marker-label')

  update(state: MatchState, view: BallView | null): void {
    const you = playerById(state, state.controlled)
    const carrying = state.ball.carrier === state.controlled
    const flight = state.phase.kind === 'flight' ? state.phase.flight : null

    // Nothing to say: the ball is in view, nobody has thrown it, and it is
    // either yours or plainly where you can see it.
    if (!view || !you || (!flight && (carrying || !view.offScreen))) {
      if (!this.element.hidden) this.element.hidden = true
      return
    }

    this.element.hidden = false
    this.element.style.left = `${view.x * 100}%`
    this.element.style.top = `${view.y * 100}%`
    this.arrow.hidden = !view.offScreen
    this.arrow.style.transform = `rotate(${view.angle}rad)`

    const reading = flight ? this.throwReading(state, flight) : this.distanceReading(state, you)
    this.paint(reading)
  }

  /**
   * What the throw has left, and whether that is going to be enough.
   *
   * A shot is measured against the middle of the keeper's catching, which is the
   * same figure the AI shoots against — not the bare stat, because the band is
   * not centred on it. A pass only has to arrive with something.
   */
  private throwReading(state: MatchState, flight: NonNullable<Flight>): Reading {
    const left = Math.max(0, Math.round(powerLeft(flight)));

    if (flight.kind === 'spilled') return { text: 'spilled', tone: 'marker-failing' }

    if (flight.kind === 'pass') {
      return {
        text: `PA ${left}`,
        tone: left > 0 ? 'marker-holding' : 'marker-failing',
      }
    }

    const keeper = keeperFor(state, opponentOf(flight.fromTeam))
    const facing = keeper ? Math.round(expectedCatch(effectiveStat(keeper, 'ca'))) : 0
    return {
      text: `SH ${left} vs CA ${facing}`,
      tone: left > facing ? 'marker-holding' : 'marker-failing',
    }
  }

  private distanceReading(state: MatchState, you: { x: number; y: number }): Reading {
    const carrier = state.ball.carrier ? playerById(state, state.ball.carrier) : undefined
    return {
      text: `${Math.round(distanceBetween(you, state.ball))}m`,
      tone: !carrier ? 'marker-loose' : carrier.team === USER_TEAM ? 'marker-ours' : 'marker-theirs',
    }
  }

  private paint(reading: Reading): void {
    if (reading.text !== this.lastText) {
      this.lastText = reading.text
      this.label.textContent = reading.text
    }
    if (reading.tone !== this.lastTone) {
      this.element.classList.remove(this.lastTone)
      this.lastTone = reading.tone
      this.element.classList.add(reading.tone)
    }
  }
}

type Flight = Extract<MatchState['phase'], { kind: 'flight' }>['flight']

interface Reading {
  text: string
  tone: string
}

function span(className: string): HTMLElement {
  const element = document.createElement('span')
  element.className = className
  return element
}
