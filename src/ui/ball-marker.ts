import { USER_TEAM, type MatchState } from '../core/match/types'
import { distanceBetween, playerById } from '../core/match/queries'
import type { EdgeMarker } from '../render/off-screen'

/**
 * An arrow at the edge of the frame, pointing at play you cannot see.
 *
 * The camera holds a fixed stand-off behind whoever you are steering, which is
 * what stops the controls meaning different things in different parts of the
 * pool. The cost is that play at the far end is off screen — and the pool is now
 * 276 units goal to goal against a 51-unit stand-off, so that is a long way off
 * screen.
 *
 * Shown only when the ball is genuinely out of view, and never while you are the
 * one carrying it, since then it is a yard in front of your own nose. The
 * distance is the one from *your* player rather than from the camera: what
 * matters is how far you have to swim, not how far the lens is.
 */
export class BallMarker {
  private lastLabel = ''

  constructor(private readonly element: HTMLElement) {
    this.element.append(this.arrow, this.label)
  }

  private readonly arrow = arrowElement()
  private readonly label = labelElement()

  update(state: MatchState, marker: EdgeMarker | null): void {
    const you = playerById(state, state.controlled)
    const carrying = state.ball.carrier === state.controlled

    if (!marker || !you || carrying) {
      if (!this.element.hidden) this.element.hidden = true
      return
    }

    this.element.hidden = false
    this.element.style.left = `${marker.x * 100}%`
    this.element.style.top = `${marker.y * 100}%`
    this.arrow.style.transform = `rotate(${marker.angle}rad)`

    // Their colour, so an arrow is instantly "they have it" or "we have it"
    // rather than something to decode.
    const carrier = state.ball.carrier ? playerById(state, state.ball.carrier) : undefined
    this.element.classList.toggle('marker-theirs', !!carrier && carrier.team !== USER_TEAM)
    this.element.classList.toggle('marker-loose', !carrier)

    const label = `${Math.round(distanceBetween(you, state.ball))}m`
    if (label !== this.lastLabel) {
      this.lastLabel = label
      this.label.textContent = label
    }
  }
}

function arrowElement(): HTMLElement {
  const arrow = document.createElement('div')
  arrow.className = 'marker-arrow'
  return arrow
}

function labelElement(): HTMLElement {
  const label = document.createElement('span')
  label.className = 'marker-distance'
  return label
}
