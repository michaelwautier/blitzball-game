// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LeagueScreen } from './league-screen'
import {
  createSeason,
  nextUserFixture,
  recordResult,
  totalRounds,
  type Season,
} from '../core/league/season'
import { TEAMS } from '../data/teams'

const IDS = TEAMS.map((team) => team.id)
const USER = 'aurochs'

let element: HTMLElement
let played: ReturnType<typeof vi.fn<() => void>>
let screen: LeagueScreen

beforeEach(() => {
  element = document.createElement('div')
  element.hidden = true
  document.body.replaceChildren(element)
  played = vi.fn<() => void>()
  screen = new LeagueScreen(element, played)
})

const newSeason = (seed = 'ui') => createSeason(IDS, USER, seed)
const text = () => element.textContent ?? ''
const rows = () => [...element.querySelectorAll('.lg-table .lg-row:not(.lg-head)')]
const fixtures = () => [...element.querySelectorAll('.lg-fixture')]
const button = () => element.querySelector<HTMLButtonElement>('.lg-play')!

/**
 * Play the user's fixture and let the round catch up, without simulating.
 *
 * Scores are the user's first, whichever end of the fixture they are at — the
 * schedule sends them away half the time, and passing raw home-and-away numbers
 * quietly made them win every away match.
 */
function finishRound(season: Season, mine: number, theirs: number): void {
  const fixture = nextUserFixture(season)!
  const atHome = fixture.home === USER
  recordResult(season, fixture, atHome ? mine : theirs, atHome ? theirs : mine)

  for (const other of season.fixtures.filter((f) => f.round === fixture.round && f !== fixture)) {
    recordResult(season, other, 1, 0)
  }
}

describe('showing the league', () => {
  it('lists every side in the table', () => {
    screen.show(newSeason())
    expect(rows()).toHaveLength(TEAMS.length)
    for (const team of TEAMS) expect(text()).toContain(team.name)
  })

  it('marks the side the user manages', () => {
    screen.show(newSeason())
    const mine = element.querySelectorAll('.lg-table .lg-mine')
    expect(mine).toHaveLength(1)
    expect(mine[0]!.textContent).toContain('Besaid Aurochs')
  })

  it('says which round it is', () => {
    screen.show(newSeason())
    expect(text()).toContain(`Round 1 of ${totalRounds(newSeason())}`)
  })

  it('shows the round about to be played', () => {
    screen.show(newSeason())
    expect(fixtures()).toHaveLength(TEAMS.length / 2)
  })

  it('is hidden until shown, and empty once hidden again', () => {
    expect(element.hidden).toBe(true)
    screen.show(newSeason())
    expect(element.hidden).toBe(false)

    screen.hide()
    expect(element.hidden).toBe(true)
    expect(element.childElementCount).toBe(0)
  })
})

describe('the table itself', () => {
  it('orders sides by points once results are in', () => {
    const season = newSeason()
    finishRound(season, 5, 0)
    screen.show(season)

    // Everyone who won is above everyone who lost.
    const order = rows().map((row) => row.querySelector('.lg-team')!.textContent)
    expect(order[0]).toContain('Besaid Aurochs')
  })

  it('shows goals for and against, and the difference', () => {
    const season = newSeason()
    finishRound(season, 4, 1)
    screen.show(season)

    const mine = element.querySelector('.lg-table .lg-mine')!
    expect(mine.textContent).toContain('4:1')
    expect(mine.textContent).toContain('+3')
  })

  it('signs a negative difference without inventing a plus', () => {
    const season = newSeason()
    finishRound(season, 0, 2)
    screen.show(season)

    expect(element.querySelector('.lg-table .lg-mine')!.textContent).toContain('-2')
  })
})

describe('the fixtures', () => {
  it('shows a scoreline once a fixture is played', () => {
    const season = newSeason()
    const atHome = nextUserFixture(season)!.home === USER
    finishRound(season, 3, 1)
    screen.show(season)

    // The round just gone is reported, so the user learns how the others went.
    expect(text()).toContain('Last round')
    const lastRound = fixtures().slice(0, TEAMS.length / 2)
    const expected = atHome ? '3 – 1' : '1 – 3'
    expect(lastRound.some((row) => row.textContent?.includes(expected))).toBe(true)
  })

  it('shows the round ahead as well as the one behind', () => {
    const season = newSeason()
    finishRound(season, 1, 1)
    screen.show(season)

    expect(text()).toContain('Round 2')
    // Three fixtures behind, three ahead.
    expect(fixtures()).toHaveLength(TEAMS.length)
  })

  it('has nothing behind it in the first round', () => {
    screen.show(newSeason())
    expect(text()).not.toContain('Last round')
  })
})

describe('getting into the next match', () => {
  it('names the opponent and which end of the pool it is at', () => {
    const season = newSeason()
    const fixture = nextUserFixture(season)!
    const home = fixture.home === USER
    const opponentId = home ? fixture.away : fixture.home

    screen.show(season)
    expect(button().textContent).toContain(TEAMS.find((t) => t.id === opponentId)!.name)
    expect(button().textContent).toContain(home ? 'home' : 'away')
  })

  it('starts the match when clicked', () => {
    screen.show(newSeason())
    button().click()
    expect(played).toHaveBeenCalledOnce()
  })

  it('ignores clicks that are not on the button', () => {
    screen.show(newSeason())
    element.querySelector('.lg-title')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(played).not.toHaveBeenCalled()
  })
})

describe('the end of the season', () => {
  /** Every fixture recorded, with the user winning the lot. */
  const completed = () => {
    const season = newSeason('champions')
    for (let round = 1; round <= totalRounds(season); round++) finishRound(season, 9, 0)
    return season
  }

  it('offers no more matches', () => {
    screen.show(completed())
    expect(button().disabled).toBe(true)
    expect(button().textContent).toContain('Season complete')
  })

  it('says how the user finished', () => {
    screen.show(completed())
    // Nine goals a game and every match won leaves only one possible finish.
    expect(text()).toContain('Champions')
  })

  it('reports a finish that is not first place', () => {
    const season = newSeason('midtable')
    for (let round = 1; round <= totalRounds(season); round++) finishRound(season, 0, 1)
    screen.show(season)
    expect(text()).toMatch(/finished \d+(st|nd|rd|th)/)
  })

  it('still shows the final round rather than a round that does not exist', () => {
    screen.show(completed())
    expect(text()).toContain('Final round')
    expect(fixtures()).toHaveLength(TEAMS.length / 2)
  })
})
