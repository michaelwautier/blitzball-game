import { findTeam } from '../data/teams'
import { fixturesInRound } from '../core/league/fixtures'
import {
  currentRound,
  isPlayed,
  isSeasonOver,
  nextUserFixture,
  seasonTable,
  totalRounds,
  type Season,
} from '../core/league/season'
import type { MatchResult, TableRow } from '../core/league/standings'
import type { Fixture } from '../core/league/fixtures'

/**
 * The league screen: the table, the round, and the way into the next match.
 *
 * Everything shown is derived from the season on each render rather than kept in
 * step by hand, so there is no way for the table on screen to disagree with the
 * results behind it.
 */
export class LeagueScreen {
  constructor(
    private readonly element: HTMLElement,
    private readonly onPlay: () => void,
  ) {
    this.element.addEventListener('click', this.onClick)
  }

  show(season: Season): void {
    this.element.hidden = false
    this.render(season)
  }

  hide(): void {
    this.element.hidden = true
    this.element.replaceChildren()
  }

  dispose(): void {
    this.element.removeEventListener('click', this.onClick)
  }

  private render(season: Season): void {
    const round = currentRound(season)
    const table = seasonTable(season)

    const heading = document.createElement('h1')
    heading.className = 'lg-title'
    heading.textContent = 'Blitzball League'

    const subtitle = document.createElement('p')
    subtitle.className = 'lg-subtitle'
    subtitle.textContent = isSeasonOver(season)
      ? describeFinish(table, season.userTeamId)
      : `Round ${round} of ${totalRounds(season)}`

    const current = Math.min(round, totalRounds(season))
    const blocks: HTMLElement[] = []

    // What just happened, then what is next. Without the round behind them the
    // user never learns how the fixtures they were not in actually finished —
    // only that the table moved underneath them.
    if (isSeasonOver(season)) {
      blocks.push(this.renderRound(season, current, 'Final round'))
    } else {
      if (current > 1) blocks.push(this.renderRound(season, current - 1, 'Last round'))
      blocks.push(this.renderRound(season, current, `Round ${current}`))
    }

    this.element.replaceChildren(
      heading,
      subtitle,
      this.renderTable(table, season.userTeamId),
      ...blocks,
      this.renderAction(season),
    )
  }

  private renderTable(table: readonly TableRow[], userTeamId: string): HTMLElement {
    const grid = document.createElement('div')
    grid.className = 'lg-table'
    grid.append(headerRow())

    table.forEach((row, index) => {
      const line = document.createElement('div')
      line.className = 'lg-row'
      // The user's own side, so the eye finds it without reading every name.
      if (row.teamId === userTeamId) line.classList.add('lg-mine')

      const team = findTeam(row.teamId)
      const swatch = document.createElement('span')
      swatch.className = 'lg-swatch'
      swatch.style.background = team.colours.primary

      const name = document.createElement('span')
      name.className = 'lg-team'
      name.append(swatch, document.createTextNode(team.name))

      line.append(
        cell(String(index + 1), 'lg-pos'),
        name,
        cell(String(row.played)),
        cell(String(row.won)),
        cell(String(row.drawn)),
        cell(String(row.lost)),
        cell(`${row.scored}:${row.conceded}`),
        cell(withSign(row.difference)),
        cell(String(row.points), 'lg-points'),
      )
      grid.append(line)
    })

    return grid
  }

  private renderRound(season: Season, round: number, title: string): HTMLElement {
    const block = document.createElement('div')
    block.className = 'lg-fixtures'

    const label = document.createElement('h2')
    label.className = 'lg-fixtures-title'
    label.textContent = title
    block.append(label)

    for (const fixture of fixturesInRound(season.fixtures, round)) {
      block.append(this.renderFixture(season, fixture))
    }

    return block
  }

  private renderFixture(season: Season, fixture: Fixture): HTMLElement {
    const row = document.createElement('div')
    row.className = 'lg-fixture'
    if (fixture.home === season.userTeamId || fixture.away === season.userTeamId) {
      row.classList.add('lg-mine')
    }

    const result = season.results.find(
      (played) =>
        played.fixture.round === fixture.round &&
        played.fixture.home === fixture.home &&
        played.fixture.away === fixture.away,
    )

    row.append(
      cell(findTeam(fixture.home).name, 'lg-home'),
      cell(scoreline(result, isPlayed(season, fixture)), 'lg-score'),
      cell(findTeam(fixture.away).name, 'lg-away'),
    )
    return row
  }

  private renderAction(season: Season): HTMLElement {
    const fixture = nextUserFixture(season)

    const button = document.createElement('button')
    button.className = 'lg-play'
    button.dataset.action = 'play'

    if (!fixture) {
      button.textContent = 'Season complete'
      button.disabled = true
      return button
    }

    const home = fixture.home === season.userTeamId
    const opponent = findTeam(home ? fixture.away : fixture.home)
    button.textContent = `Play ${opponent.name} (${home ? 'home' : 'away'})`
    return button
  }

  private readonly onClick = (event: MouseEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')
    if (target?.dataset.action !== 'play') return
    this.onPlay()
  }
}

function headerRow(): HTMLElement {
  const row = document.createElement('div')
  row.className = 'lg-row lg-head'
  row.append(
    cell('', 'lg-pos'),
    cell('Team', 'lg-team'),
    cell('P'),
    cell('W'),
    cell('D'),
    cell('L'),
    cell('Goals'),
    cell('GD'),
    cell('Pts', 'lg-points'),
  )
  return row
}

function cell(text: string, className?: string): HTMLElement {
  const span = document.createElement('span')
  if (className) span.className = className
  span.textContent = text
  return span
}

function scoreline(result: MatchResult | undefined, played: boolean): string {
  if (!result) return played ? '· – ·' : 'v'
  return `${result.home} – ${result.away}`
}

function withSign(difference: number): string {
  return difference > 0 ? `+${difference}` : String(difference)
}

/** How the season ended, for the side the user was managing. */
function describeFinish(table: readonly TableRow[], userTeamId: string): string {
  const position = table.findIndex((row) => row.teamId === userTeamId) + 1
  if (position === 1) return 'Champions of the league'
  return `Season complete — finished ${ordinal(position)}`
}

function ordinal(value: number): string {
  const suffix = value === 1 ? 'st' : value === 2 ? 'nd' : value === 3 ? 'rd' : 'th'
  return `${value}${suffix}`
}
