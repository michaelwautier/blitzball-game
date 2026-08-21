// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { StatPanel } from './stat-panel'
import { createMatch } from '../core/match/state'
import { giveBallTo } from '../core/match/possession'
import { applyStatus } from '../core/match/status'
import { effectiveStat } from '../core/match/stats'
import type { MatchState, Player } from '../core/match/types'
import { BESAID_AUROCHS, LUCA_GOERS } from '../data/teams'

let element: HTMLElement
let panel: StatPanel

beforeEach(() => {
  element = document.createElement('div')
  element.hidden = true
  document.body.replaceChildren(element)
  panel = new StatPanel(element)
})

const find = (state: MatchState, id: string): Player => {
  const player = state.players.find((p) => p.id === id)
  if (!player) throw new Error(`no player ${id}`)
  return player
}

/** A match with `carrierId` holding the ball. */
function carrying(carrierId = 'home:wakka'): MatchState {
  const state = createMatch(BESAID_AUROCHS, LUCA_GOERS, 'panel')
  giveBallTo(state, find(state, carrierId))
  state.phase = { kind: 'play' }
  return state
}

/** Put `carrierId` in an encounter against the named opponents. */
function caught(carrierId: string, defenderIds: string[]): MatchState {
  const state = carrying(carrierId)
  state.phase = {
    kind: 'encounter',
    encounter: {
      kind: 'contested',
      carrierId,
      defenders: defenderIds.map((id, index) => ({ id, attack: 11 + index, block: 5 + index })),
      endurance: 14,
      thinkTimer: 0,
      awaitingDefence: false,
      defence: null,
    },
  }
  return state
}

const rows = () => [...element.querySelectorAll('.sp-row')]
const names = () => [...element.querySelectorAll('.sp-name')].map((n) => n.textContent)
const text = () => element.textContent ?? ''

describe('the player on the ball', () => {
  it('shows their name and what they can do with it', () => {
    panel.update(carrying())
    expect(element.hidden).toBe(false)
    expect(names()).toEqual(['Wakka'])
    for (const label of ['HP', 'EN', 'PA', 'SH']) expect(text()).toContain(label)
  })

  it('shows the opponent when the opponent has it, as FFX does', () => {
    panel.update(carrying('away:bickson'))
    expect(names()).toEqual(['Bickson'])
  })

  it('hides itself while the ball is loose', () => {
    const state = carrying()
    state.ball.carrier = null
    panel.update(state)
    expect(element.hidden).toBe(true)
  })

  it('follows the ball to whoever has it next', () => {
    const state = carrying()
    panel.update(state)
    expect(names()).toEqual(['Wakka'])

    giveBallTo(state, find(state, 'home:tidus'))
    panel.update(state)
    expect(names()).toEqual(['Tidus'])
  })
})

describe('the stats it reports', () => {
  it('reports what the player can produce now, not what is printed on them', () => {
    // A withered passer throws at reduced strength, and the panel must say so —
    // these are the numbers the engine is about to roll.
    const state = carrying()
    const wakka = find(state, 'home:wakka')
    applyStatus(wakka, { kind: 'wither', stat: 'pa', duration: 10, magnitude: 0.4 })

    panel.update(state)
    const shown = [...element.querySelectorAll('.sp-stat')].map((n) => n.textContent)
    expect(shown).toContain(`${effectiveStat(wakka, 'pa')}PA`)
    expect(effectiveStat(wakka, 'pa')).toBeLessThan(wakka.stats.pa)
  })

  it('tracks HP as it drains', () => {
    const state = carrying()
    const wakka = find(state, 'home:wakka')
    panel.update(state)
    expect(text()).toContain(`${Math.round(wakka.hp)}HP`)

    wakka.hp -= 20
    panel.update(state)
    expect(text()).toContain(`${Math.round(wakka.hp)}HP`)
  })
})

describe('the defenders on them', () => {
  it('lists one row per defender, under the carrier', () => {
    panel.update(caught('home:wakka', ['away:doram', 'away:balgerda']))
    expect(names()).toEqual(['Wakka', 'Doram', 'Balgerda'])
    expect(rows()).toHaveLength(3)
  })

  it('shows what each of them threatens, and nothing else', () => {
    panel.update(caught('home:wakka', ['away:doram']))
    const defender = element.querySelector('.sp-defender')!
    // Attack threatens the breakthrough, blocking threatens the throw.
    expect(defender.textContent).toContain('AT')
    expect(defender.textContent).toContain('BL')
    expect(defender.textContent).not.toContain('SH')
  })

  it('quotes the encounter s own snapshot, so the panel cannot drift from the roll', () => {
    const state = caught('home:wakka', ['away:doram'])
    if (state.phase.kind !== 'encounter') throw new Error('expected an encounter')
    state.phase.encounter.defenders[0]!.attack = 99

    panel.update(state)
    expect(element.querySelector('.sp-defender')!.textContent).toContain('99AT')
  })

  it('drops a defender once they have been broken past', () => {
    const state = caught('home:wakka', ['away:doram', 'away:balgerda'])
    panel.update(state)
    expect(names()).toHaveLength(3)

    if (state.phase.kind !== 'encounter') throw new Error('expected an encounter')
    state.phase.encounter.defenders = [{ id: 'away:balgerda', attack: 9, block: 8 }]
    panel.update(state)

    expect(names()).toEqual(['Wakka', 'Balgerda'])
  })

  it('shows nobody during open play', () => {
    panel.update(carrying())
    expect(element.querySelectorAll('.sp-defender')).toHaveLength(0)
  })

  it('shows nobody when the encounter belongs to someone else', () => {
    const state = caught('home:wakka', ['away:doram'])
    if (state.phase.kind !== 'encounter') throw new Error('expected an encounter')
    state.phase.encounter.carrierId = 'home:tidus'

    panel.update(state)
    expect(element.querySelectorAll('.sp-defender')).toHaveLength(0)
  })
})

/**
 * The keeper, while a shot is being weighed.
 *
 * Their catching is the last thing between the throw and the net, and the only
 * figure in the decision that appears nowhere else — the menu's odds stop at the
 * defenders in front of the shooter.
 */
describe('the keeper on a shot', () => {
  const names = () => [...element.querySelectorAll('.sp-name')].map((n) => n.textContent ?? '')
  const keeperRow = () => element.querySelector('.sp-keeper')

  it('appears only while a shot is what is being considered', () => {
    const state = caught('home:wakka', ['away:doram'])

    panel.update(state, false)
    expect(keeperRow(), 'the keeper was up before a shot was chosen').toBeNull()

    panel.update(state, true)
    expect(keeperRow()).not.toBeNull()
  })

  it('is the keeper of the goal being shot at, not our own', () => {
    const state = caught('home:wakka', ['away:doram'])
    panel.update(state, true)

    // Wakka attacks the away goal, so it is their keeper who has to catch it.
    expect(names()).toContain(find(state, 'away:raudy').def.name)
    expect(names()).not.toContain(find(state, 'home:keepa').def.name)
  })

  it('shows the catching the shot has to beat', () => {
    const state = caught('home:wakka', ['away:doram'])
    panel.update(state, true)

    const nedus = find(state, 'away:raudy')
    expect(keeperRow()?.textContent).toContain(String(effectiveStat(nedus, 'ca')))
    expect(keeperRow()?.textContent).toContain('CA')
  })

  it('shows what they can catch now rather than what is printed on them', () => {
    const state = caught('home:wakka', ['away:doram'])
    const raudy = find(state, 'away:raudy')
    applyStatus(raudy, { kind: 'wither', stat: 'ca', duration: 10, magnitude: 0.4 })

    panel.update(state, true)

    // Withered, and the engine will roll the reduced figure — so that is the
    // figure a shooter is entitled to see.
    expect(effectiveStat(raudy, 'ca')).toBeLessThan(raudy.stats.ca)
    expect(keeperRow()?.textContent).toContain(String(effectiveStat(raudy, 'ca')))
  })

  it('goes away again when the choice moves off shooting', () => {
    const state = caught('home:wakka', ['away:doram'])
    panel.update(state, true)
    expect(keeperRow()).not.toBeNull()

    panel.update(state, false)
    expect(keeperRow(), 'the keeper stayed up after the choice moved on').toBeNull()
  })

  it('sits below the defenders, not above them', () => {
    // Reading order is the decision in order: who has it, who is in the way,
    // and who is behind them.
    const state = caught('home:wakka', ['away:doram', 'away:balgerda'])
    panel.update(state, true)

    const classes = [...element.querySelectorAll('.sp-row')].map((r) => r.className)
    expect(classes.at(0)).toContain('sp-carrier')
    expect(classes.at(-1)).toContain('sp-keeper')
  })
})
