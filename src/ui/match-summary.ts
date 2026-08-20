import type { CareerProgress } from '../core/progression/career'
import { USER_TEAM, type MatchState } from '../core/match/state'
import type { PlayerStats } from '../data/types'

const STAT_LABELS: Record<keyof PlayerStats, string> = {
  hp: 'HP',
  sp: 'SP',
  en: 'EN',
  at: 'AT',
  pa: 'PA',
  bl: 'BL',
  sh: 'SH',
  ca: 'CA',
}

/**
 * The full-time screen: the result, then what everyone earned from it.
 *
 * Experience is only interesting if you can see what it bought, so this leads
 * with the stat points gained rather than the raw numbers — "Tidus reached
 * level 3, SH +1 SP +1" says more than "Tidus, 64 exp".
 */
export class MatchSummary {
  private shown = false

  constructor(
    private readonly element: HTMLElement,
    private readonly onPlayAgain: () => void,
  ) {
    this.element.addEventListener('click', this.onClick)
  }

  /** Render once, when the match ends. Hidden at any other time. */
  update(state: MatchState, progress: () => CareerProgress[]): void {
    if (state.phase.kind !== 'fullTime') {
      if (this.shown) this.hide()
      return
    }
    if (this.shown) return

    this.shown = true
    this.element.hidden = false
    this.render(state, progress())
  }

  dispose(): void {
    this.element.removeEventListener('click', this.onClick)
  }

  private hide(): void {
    this.shown = false
    this.element.hidden = true
    this.element.replaceChildren()
  }

  private render(state: MatchState, progress: CareerProgress[]): void {
    const { home, away } = state.teams

    const heading = document.createElement('h2')
    heading.className = 'sum-score'
    heading.textContent = `${home.def.abbreviation} ${home.score} – ${away.score} ${away.def.abbreviation}`

    const verdict = document.createElement('div')
    verdict.className = 'sum-verdict'
    verdict.textContent = describeResult(state)

    const table = document.createElement('ul')
    table.className = 'sum-list'

    // Only the user's own players: another team's development is not their news.
    const mine = progress.filter((p) => p.playerId.startsWith(`${USER_TEAM}:`))
    if (mine.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'sum-empty'
      empty.textContent = 'Nobody got on the ball enough to learn anything.'
      table.append(empty)
    }

    for (const player of mine) table.append(this.renderPlayer(player))

    const button = document.createElement('button')
    button.className = 'sum-again'
    button.dataset.action = 'play-again'
    button.textContent = 'Next match'

    this.element.replaceChildren(heading, verdict, table, button)
  }

  private renderPlayer(player: CareerProgress): HTMLElement {
    const row = document.createElement('li')
    row.className = 'sum-row'

    const name = document.createElement('span')
    name.className = 'sum-name'
    name.textContent = player.name

    const exp = document.createElement('span')
    exp.className = 'sum-exp'
    exp.textContent = `+${player.expGained} exp`

    row.append(name, exp)

    if (player.levelAfter > player.levelBefore) {
      const level = document.createElement('span')
      level.className = 'sum-level'
      level.textContent = `Lv ${player.levelBefore} → ${player.levelAfter}`
      row.append(level)

      const gains = document.createElement('span')
      gains.className = 'sum-gains'
      gains.textContent = formatIncreases(player.totalIncreases)
      row.append(gains)
    }

    return row
  }

  private readonly onClick = (event: MouseEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')
    if (target?.dataset.action !== 'play-again') return
    this.hide()
    this.onPlayAgain()
  }
}

function describeResult(state: MatchState): string {
  const { home, away } = state.teams
  if (home.score > away.score) return `${home.def.name} win`
  if (away.score > home.score) return `${away.def.name} win`
  return 'Draw'
}

function formatIncreases(increases: Partial<Record<keyof PlayerStats, number>>): string {
  const parts = (Object.keys(STAT_LABELS) as (keyof PlayerStats)[])
    .filter((key) => (increases[key] ?? 0) > 0)
    .map((key) => `${STAT_LABELS[key]} +${increases[key]}`)

  return parts.length > 0 ? parts.join('  ') : 'no stat gains'
}
