import type { MatchState } from '../core/match/state'

/**
 * Time and score, in the DOM, laid out as FFX lays them out: a `TIME` line with
 * the score beneath it, tucked under the radar in the bottom-right corner.
 *
 * These used to be painted into the pitch canvas. Once that canvas shrank to a
 * corner radar they had to move, and the DOM is the better home anyway: text
 * stays crisp at any pixel ratio without being scaled by a world transform, and
 * it never has to be redrawn just because the ball moved.
 *
 * The structure is built once and only the text that changed is rewritten, so a
 * clock ticking does not churn the whole subtree sixty times a second.
 */
export class Scoreboard {
  private readonly time: HTMLElement
  private readonly half: HTMLElement
  private readonly homeGoals: HTMLElement
  private readonly awayGoals: HTMLElement

  private lastTime = ''
  private lastHalf = ''
  private lastScore = ''
  private lastMessage = ''
  private dressed = false

  constructor(
    private readonly scoreElement: HTMLElement,
    private readonly bannerElement: HTMLElement,
  ) {
    this.time = span('sb-time-value')
    this.half = span('sb-half')
    this.homeGoals = span('sb-goals')
    this.awayGoals = span('sb-goals')

    const timeRow = document.createElement('div')
    timeRow.className = 'sb-time'
    timeRow.append(span('sb-time-label', 'TIME'), this.time, this.half)

    this.scoreElement.replaceChildren(timeRow, this.scoreRow())
  }

  /** The score line: each side's colours, abbreviation and goals. */
  private scoreRow(): HTMLElement {
    const row = document.createElement('div')
    row.className = 'sb-score'
    row.append(
      span('sb-team sb-home'),
      this.homeGoals,
      this.awayGoals,
      span('sb-team sb-away'),
    )
    return row
  }

  update(state: MatchState): void {
    const { home, away } = state.teams

    // Team identity cannot change mid-match, so it is written once.
    if (!this.dressed) {
      this.dressed = true
      dressTeam(this.scoreElement.querySelector('.sb-home')!, home.def, 'before')
      dressTeam(this.scoreElement.querySelector('.sb-away')!, away.def, 'after')
    }

    const time = formatClock(state.clock)
    if (time !== this.lastTime) {
      this.lastTime = time
      this.time.textContent = time
    }

    const half = `H${state.half}`
    if (half !== this.lastHalf) {
      this.lastHalf = half
      this.half.textContent = half
    }

    const score = `${home.score}-${away.score}`
    if (score !== this.lastScore) {
      this.lastScore = score
      this.homeGoals.textContent = String(home.score)
      this.awayGoals.textContent = String(away.score)
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

/** A team's swatch and abbreviation, the swatch on the outside like FFX's crests. */
function dressTeam(
  element: Element,
  team: MatchState['teams']['home']['def'],
  swatchOn: 'before' | 'after',
): void {
  const swatch = document.createElement('i')
  swatch.className = 'sb-swatch'
  swatch.style.background = team.colours.primary

  const name = document.createTextNode(team.abbreviation)
  element.replaceChildren(...(swatchOn === 'before' ? [swatch, name] : [name, swatch]))
}

function span(className: string, text = ''): HTMLElement {
  const element = document.createElement('span')
  element.className = className
  element.textContent = text
  return element
}

/** Whole seconds, counting down within the half. */
function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}
