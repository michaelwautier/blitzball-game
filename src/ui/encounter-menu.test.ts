// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EncounterMenu } from './encounter-menu'
import { createMatch } from '../core/match/state'
import { giveBallTo } from '../core/match/possession'
import { ACTION_HP_COST } from '../core/encounter/formulas'
import { findTechnique } from '../data/techniques'
import type { Encounter, EncounterAction, MatchState, Player } from '../core/match/types'
import { BESAID_AUROCHS, LUCA_GOERS } from '../data/teams'

/**
 * The menu holds real logic — four steps, three kinds of decision, technique
 * affordability, and remembering a pass target across a step — and a mistake in
 * any of it sends the ball to the wrong player or offers an action the engine
 * will refuse. It needs a DOM, so this file alone runs under jsdom.
 */

let element: HTMLElement
let menu: EncounterMenu
let onAction: ReturnType<typeof vi.fn>
let onDefend: ReturnType<typeof vi.fn>
let onCancel: ReturnType<typeof vi.fn>
/** The state the menu is currently showing, so `press` can repaint like the app does. */
let current: MatchState

beforeEach(() => {
  element = document.createElement('div')
  element.hidden = true
  document.body.append(element)
  onAction = vi.fn()
  onDefend = vi.fn()
  onCancel = vi.fn()
  menu = new EncounterMenu(element, {
    onAction: onAction as (a: EncounterAction) => void,
    onDefend: onDefend as (id: string | null) => void,
    onCancel: onCancel as () => void,
  })
})

afterEach(() => {
  // Every menu attaches a window listener; leaking them across tests would let
  // an earlier menu answer a later test's keypress.
  menu.dispose()
  element.remove()
})

function find(state: MatchState, id: string): Player {
  const player = state.players.find((p) => p.id === id)
  if (!player) throw new Error(`no player ${id}`)
  return player
}

/** A match with `carrierId` on the ball and a decision of `kind` open. */
function openMenu(
  kind: Encounter['kind'],
  carrierId = 'home:wakka',
  endurance = 14,
): MatchState {
  const state = createMatch(BESAID_AUROCHS, LUCA_GOERS, 'menu')
  const carrier = find(state, carrierId)
  giveBallTo(state, carrier)

  const defenders =
    kind === 'contested' ? [{ id: 'away:doram', attack: 11, block: 5 }] : []

  state.phase = {
    kind: 'encounter',
    encounter: {
      kind,
      carrierId,
      defenders,
      endurance,
      thinkTimer: 0,
      awaitingDefence: false,
      defence: null,
    },
  }
  current = state
  menu.update(state)
  return state
}

const labels = () =>
  [...element.querySelectorAll('.enc-label')].map((n) => n.textContent ?? '')

const details = () =>
  [...element.querySelectorAll('.enc-detail')].map((n) => n.textContent ?? '')

const buttons = () => [...element.querySelectorAll<HTMLButtonElement>('.enc-option')]

/**
 * Press a key, then repaint.
 *
 * The menu renders when it is next polled rather than immediately, because the
 * render loop calls `update` every frame. Driving it the same way here keeps the
 * tests honest about the real contract between the two.
 */
const press = (key: string) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  menu.update(current)
}

const click = (index: number) => {
  buttons()[index]?.click()
  menu.update(current)
}

describe('when the menu shows at all', () => {
  it('stays hidden during open play', () => {
    const state = createMatch(BESAID_AUROCHS, LUCA_GOERS, 'play')
    state.phase = { kind: 'play' }
    menu.update(state)
    expect(element.hidden).toBe(true)
  })

  it('stays hidden for the opponent s decision', () => {
    const state = openMenu('contested', 'away:bickson')
    menu.update(state)
    expect(element.hidden).toBe(true)
  })

  it('closes again once the decision is over', () => {
    const state = openMenu('contested')
    expect(element.hidden).toBe(false)

    state.phase = { kind: 'play' }
    menu.update(state)

    expect(element.hidden).toBe(true)
    expect(element.children).toHaveLength(0)
  })
})

describe('what each kind of decision offers', () => {
  it('offers everything when defenders have committed', () => {
    openMenu('contested')
    expect(labels()).toEqual(['Breakthrough', 'Pass', 'Shoot'])
  })

  it('shows the endurance contest only when contested', () => {
    openMenu('contested')
    const odds = element.querySelector('.enc-odds')?.textContent ?? ''
    expect(odds).toContain('EN 14')
    // A range, not a promise: the tackle is rolled when it is made.
    expect(odds).toMatch(/AT 6–17/)
  })

  it('drops breakthrough when the carrier stopped by choice', () => {
    openMenu('onTheBall')
    expect(labels()).toEqual(['Pass', 'Shoot', 'Keep swimming'])
  })

  it('sends a keeper straight to the target list', () => {
    const state = openMenu('distribution', 'home:keepa')
    // No action list at all: the five outfielders are the only choice.
    expect(labels()).toHaveLength(5)
    expect(labels()).not.toContain('Shoot')
    expect(state.players.filter((p) => p.team === 'home' && p.slot !== 'GK')).toHaveLength(5)
  })
})

describe('choosing an action', () => {
  it('asks how many to break past rather than barging blindly', () => {
    openMenu('contested')
    press('1')
    expect(onAction).not.toHaveBeenCalled()
    expect(labels()).toEqual(['No Break', 'Break to Doram'])
  })

  it('commits a breakthrough by key', () => {
    openMenu('contested', 'home:wakka', 40)
    press('1')
    press('2')
    expect(onAction).toHaveBeenCalledWith({ kind: 'breakthrough', breakPast: 1 })
  })

  it('commits a breakthrough by click', () => {
    openMenu('contested', 'home:wakka', 40)
    click(0)
    click(1)
    expect(onAction).toHaveBeenCalledWith({ kind: 'breakthrough', breakPast: 1 })
  })

  it('ignores a key with no row behind it', () => {
    openMenu('contested')
    press('9')
    expect(onAction).not.toHaveBeenCalled()
  })

  it('opens the target list rather than passing blindly', () => {
    openMenu('contested')
    press('2')
    expect(onAction).not.toHaveBeenCalled()
    expect(labels()).toContain('Tidus')
  })

  it('marks which teammates are covered', () => {
    const state = openMenu('contested')
    const tidus = find(state, 'home:tidus')
    const marker = find(state, 'away:balgerda')
    marker.x = tidus.x
    marker.y = tidus.y
    menu.update(state)

    press('2')
    expect(labels()).toContain('Tidus')
    const tidusRow = labels().indexOf('Tidus')
    expect(details()[tidusRow]).toContain('marked')
  })
})

describe('the pass target list', () => {
  it('puts the nearest teammate first', () => {
    const state = openMenu('contested')
    const carrier = find(state, 'home:wakka')

    // Spread the side out at known distances from the passer.
    const spread: [string, number][] = [
      ['home:tidus', 30],
      ['home:letty', 10],
      ['home:jassu', 50],
      ['home:datto', 20],
    ]
    for (const [id, distance] of spread) {
      const mate = find(state, id)
      mate.x = carrier.x + distance
      mate.y = carrier.y
    }
    menu.update(state)

    press('2')
    const order = labels()
    // Nearest first, so the safest ball is at the top of the list.
    expect(order.indexOf('Letty')).toBeLessThan(order.indexOf('Datto'))
    expect(order.indexOf('Datto')).toBeLessThan(order.indexOf('Tidus'))
    expect(order.indexOf('Tidus')).toBeLessThan(order.indexOf('Jassu'))
  })

  it('shows each teammate s distance alongside them', () => {
    const state = openMenu('contested')
    const carrier = find(state, 'home:wakka')
    const mate = find(state, 'home:letty')
    mate.x = carrier.x + 25
    mate.y = carrier.y
    menu.update(state)

    press('2')
    const row = labels().indexOf('Letty')
    expect(details()[row]).toContain('25m')
  })
})

describe('choosing how many to break past', () => {
  it('offers standing pat, then each defender in turn', () => {
    openMenu('contested')
    press('1')
    // One defender in the fixture. FFX names them rather than counting, which
    // is only possible because at most two ever engage.
    expect(labels()).toEqual(['No Break', 'Break to Doram'])
  })

  it('names the defenders cumulatively when two are on the carrier', () => {
    const state = openMenu('contested')
    if (state.phase.kind !== 'encounter') throw new Error('expected an encounter')
    state.phase.encounter.defenders = [
      { id: 'away:doram', attack: 11, block: 5 },
      { id: 'away:balgerda', attack: 9, block: 8 },
    ]
    menu.update(state)
    press('1')

    // Breaking to the second means going through the first as well.
    expect(labels()).toEqual(['No Break', 'Break to Doram', 'Break to Doram & Balgerda'])
  })

  it('commits the break at the depth chosen', () => {
    openMenu('contested', 'home:wakka', 40)
    press('1')
    press('2')
    expect(onAction).toHaveBeenCalledWith({ kind: 'breakthrough', breakPast: 1 })
  })

  it('shows what a break costs, and what is left facing the carrier', () => {
    const state = openMenu('contested', 'home:wakka', 40)
    if (state.phase.kind !== 'encounter') throw new Error('expected an encounter')
    state.phase.encounter.defenders = [
      { id: 'away:doram', attack: 11, block: 5 },
      { id: 'away:balgerda', attack: 9, block: 8 },
    ]
    menu.update(state)
    press('1')

    // Beating one leaves the other still blocking; beating both frees them.
    expect(details()[1]).toContain('costs EN')
    expect(details()[1]).toMatch(/still facing BL \d+–\d+/)
    expect(details()[2]).toContain('free to swim on')
  })

  it('will not offer a challenge the carrier cannot survive at all', () => {
    // Endurance below even the best case of the tackle waiting for them.
    openMenu('contested', 'home:wakka', 2)
    press('1')
    expect(buttons()[1]!.disabled).toBe(true)
  })

  it('offers it when there is endurance to spare', () => {
    openMenu('contested', 'home:wakka', 40)
    press('1')
    expect(buttons()[1]!.disabled).toBe(false)
  })

  it('backs out to the action list rather than committing anything', () => {
    openMenu('contested')
    press('1')
    press('1')
    expect(onAction).not.toHaveBeenCalled()
    expect(labels()).toEqual(['Breakthrough', 'Pass', 'Shoot'])
  })
})

describe('the technique step', () => {
  it('lists the plain action first, then what the player knows', () => {
    openMenu('contested')
    press('3')
    // Wakka knows Venom Shot.
    expect(labels()).toEqual(['Straight shot', 'Venom Shot'])
  })

  it('prices each option in HP', () => {
    openMenu('contested')
    press('3')
    const venom = findTechnique('venom-shot')
    expect(details()[0]).toContain(`${ACTION_HP_COST.shoot} HP`)
    expect(details()[1]).toContain(`${ACTION_HP_COST.shoot + venom.hpCost} HP`)
  })

  it('commits the plain action', () => {
    openMenu('contested')
    press('3')
    press('1')
    expect(onAction).toHaveBeenCalledWith({ kind: 'shoot', techniqueId: null })
  })

  it('commits the technique', () => {
    openMenu('contested')
    press('3')
    press('2')
    expect(onAction).toHaveBeenCalledWith({ kind: 'shoot', techniqueId: 'venom-shot' })
  })

  it('disables a technique the carrier cannot pay for', () => {
    const state = openMenu('contested')
    find(state, 'home:wakka').hp = 1
    menu.update(state)

    press('3')
    expect(labels()).toEqual(['Straight shot', 'Venom Shot'])
    expect(buttons()[1]!.disabled).toBe(true)

    press('2')
    expect(onAction).not.toHaveBeenCalled()
  })

  it('is skipped entirely for a player who knows none', () => {
    // Letty knows only a tackle technique, so shooting has nothing to offer
    // and the row commits straight away.
    openMenu('contested', 'home:letty')
    press('3')
    expect(onAction).toHaveBeenCalledWith({ kind: 'shoot', techniqueId: null })
  })

  it('passes straight through for a player with no pass techniques', () => {
    openMenu('contested', 'home:letty')
    press('2')
    press('1')

    expect(onAction).toHaveBeenCalledTimes(1)
    const action = onAction.mock.calls[0]![0] as EncounterAction
    expect(action.kind).toBe('pass')
  })
})

describe('remembering the pass target', () => {
  it('sends the ball to the teammate that was chosen, not the first one', () => {
    openMenu('contested')
    press('2')

    // Pick the third name on the list, then a technique, and check the ball
    // still goes to that player rather than whoever the rows were rebuilt with.
    const chosen = labels()[2]
    press('3')
    // Then the technique, which is now the only step left.
    press('1')

    const action = onAction.mock.calls[0]![0] as EncounterAction
    expect(action.kind).toBe('pass')
    if (action.kind === 'pass') {
      const state = createMatch(BESAID_AUROCHS, LUCA_GOERS, 'menu')
      expect(find(state, action.targetId).def.name).toBe(chosen)
    }
  })

  it('keeps the target when a technique is chosen', () => {
    openMenu('contested')
    press('2')
    const chosen = labels()[1]
    press('2')
    press('2')

    const action = onAction.mock.calls[0]![0] as EncounterAction
    if (action.kind === 'pass') {
      const state = createMatch(BESAID_AUROCHS, LUCA_GOERS, 'menu')
      expect(find(state, action.targetId).def.name).toBe(chosen)
      expect(action.techniqueId).toBe('venom-pass')
    }
  })
})

describe('after a break lands', () => {
  it('starts the decision again from the top, against whoever is left', () => {
    const state = openMenu('contested', 'home:wakka', 40)
    if (state.phase.kind !== 'encounter') throw new Error('expected an encounter')
    state.phase.encounter.defenders = [
      { id: 'away:doram', attack: 11, block: 5 },
      { id: 'away:balgerda', attack: 9, block: 8 },
    ]
    menu.update(state)

    press('1')
    expect(labels()).toContain('Break to Doram')

    // The engine resolves the break and leaves the encounter open against one.
    state.phase.encounter.defenders = [{ id: 'away:balgerda', attack: 9, block: 8 }]
    menu.update(state)

    // Back to the full choice: with one fewer in the way, shooting may now be on.
    expect(labels()).toEqual(['Breakthrough', 'Pass', 'Shoot'])
  })

  it('forgets a pass target chosen before the break', () => {
    const state = openMenu('contested', 'home:wakka', 40)
    press('2')
    expect(labels()).toContain('Tidus')

    if (state.phase.kind !== 'encounter') throw new Error('expected an encounter')
    state.phase.encounter.defenders = []
    menu.update(state)

    expect(labels()).toEqual(['Breakthrough', 'Pass', 'Shoot'])
  })
})

describe('going back', () => {
  it('steps back through each question in turn', () => {
    openMenu('contested')
    press('2')
    expect(labels()).toContain('Tidus')

    press('1')
    expect(labels()).toContain('Straight pass')

    press('Escape')
    expect(labels()).toContain('Tidus')

    press('Escape')
    expect(labels()).toEqual(['Breakthrough', 'Pass', 'Shoot'])
  })

  it('steps back out of the break question without committing one', () => {
    openMenu('contested')
    press('1')
    expect(labels()).toContain('No Break')

    press('Escape')
    expect(labels()).toEqual(['Breakthrough', 'Pass', 'Shoot'])
    expect(onAction).not.toHaveBeenCalled()
  })

  it('steps from the targets back to the actions', () => {
    openMenu('contested')
    press('2')
    press('Escape')
    expect(labels()).toEqual(['Breakthrough', 'Pass', 'Shoot'])
  })

  it('abandons a menu the carrier opened themselves', () => {
    openMenu('onTheBall')
    press('Escape')
    expect(onCancel).toHaveBeenCalled()
  })

  it('offers that as a visible row too', () => {
    openMenu('onTheBall')
    press('3')
    expect(onCancel).toHaveBeenCalled()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('will not let a contested carrier walk away', () => {
    openMenu('contested')
    press('Escape')
    expect(onCancel).not.toHaveBeenCalled()
    expect(labels()).toEqual(['Breakthrough', 'Pass', 'Shoot'])
  })

  it('will not let a keeper hold on to the ball', () => {
    openMenu('distribution', 'home:keepa')
    press('Escape')
    expect(onCancel).not.toHaveBeenCalled()
    // Still on the target list, with nothing else on offer.
    expect(labels()).toHaveLength(5)
  })

  it('only advertises Esc when it does something', () => {
    openMenu('contested')
    expect(element.querySelector('.enc-hint')?.textContent).not.toContain('Esc')

    openMenu('onTheBall')
    expect(element.querySelector('.enc-hint')?.textContent).toContain('Esc')
  })
})

describe('keyboard hygiene', () => {
  it('ignores keys once the menu has closed', () => {
    const state = openMenu('contested')
    state.phase = { kind: 'play' }
    menu.update(state)

    press('1')
    expect(onAction).not.toHaveBeenCalled()
  })

  it('stops listening after dispose', () => {
    openMenu('contested')
    menu.dispose()
    press('1')
    expect(onAction).not.toHaveBeenCalled()
  })
})
