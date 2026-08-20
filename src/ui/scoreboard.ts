import type { MatchState } from '../core/match/state'

/**
 * Score, clock and the running commentary, in the DOM.
 *
 * These used to be painted into the pitch canvas. Once that canvas shrank to a
 * corner radar they had to move, and the DOM is the better home anyway: text
 * stays crisp at any pixel ratio without being scaled by a world transform, and
 * it never has to be redrawn just because the ball moved.
 */
export class Scoreboard {
  private lastScore = ''
  private lastClock = ''
  private lastMessage = ''

  constructor(
    private readonly scoreElement: HTMLElement,
    private readonly bannerElement: HTMLElement,
  ) {}

  update(state: MatchState): void {
    const { home, away } = state.teams

    const score = `${home.def.abbreviation} ${home.score} – ${away.score} ${away.def.abbreviation}`
    if (score !== this.lastScore) {
      this.lastScore = score
      this.scoreElement.querySelector('.score-line')!.textContent = score
    }

    const clock = `${formatClock(state.clock)}  ·  H${state.half}`
    if (clock !== this.lastClock) {
      this.lastClock = clock
      this.scoreElement.querySelector('.score-clock')!.textContent = clock
    }

    this.updateBanner(state)
  }

  private updateBanner(state: MatchState): void {
    const message = state.announcement ?? ''
    // A goal or full time deserves the whole screen; a pass does not.
    const emphatic = state.phase.kind === 'celebration' || state.phase.kind === 'fullTime'

    if (message === this.lastMessage) return
    this.lastMessage = message

    this.bannerElement.hidden = message === ''
    this.bannerElement.textContent = message
    this.bannerElement.classList.toggle('banner-emphatic', emphatic)
  }
}

/** Whole seconds, counting down within the half. */
function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}
