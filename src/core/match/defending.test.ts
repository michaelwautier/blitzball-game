import { describe, expect, it } from 'vitest'
import { createMatch, stepMatch, submitDefence, submitEncounterAction } from './state'
import { giveBallTo } from './possession'
import { hasStatus } from './status'
import {
  ENGAGE_RADIUS,
  defensiveTechniques,
  engagingDefenders,
  openEncounter,
  resolveEncounter,
} from '../encounter/encounter'
import { chooseTackleTechnique } from '../ai/decisions'
import type { MatchState, Player } from './types'
import { BESAID_AUROCHS, LUCA_GOERS } from '../../data/teams'

const TICK = 1 / 60
const newMatch = (seed = 'defend') => createMatch(BESAID_AUROCHS, LUCA_GOERS, seed)

/** Read the phase through a call, so an earlier assignment does not narrow it. */
const phaseOf = (state: MatchState): MatchState['phase'] => state.phase

function find(state: MatchState, id: string): Player {
  const player = state.players.find((p) => p.id === id)
  if (!player) throw new Error(`no player ${id}`)
  return player
}

/** An opposing carrier running at the user's defenders. */
function runAtUs(state: MatchState, defenderIds: string[]): Player {
  const carrier = find(state, 'away:bickson')
  carrier.x = 0
  carrier.y = 0
  giveBallTo(state, carrier)

  state.players
    .filter((p) => p.team === 'home' && p.slot !== 'GK')
    .forEach((defender) => {
      const engaged = defenderIds.includes(defender.id)
      defender.x = engaged ? ENGAGE_RADIUS - 1 : -90
      defender.y = engaged ? defenderIds.indexOf(defender.id) * 0.8 : 60
      defender.recovery = 0
      defender.lunge = null
    })

  state.engageCooldown = 0
  state.phase = { kind: 'play' }
  return carrier
}

describe('being run at', () => {
  it('asks the defence how it is challenging', () => {
    const state = newMatch()
    runAtUs(state, ['home:letty'])
    stepMatch(state, TICK)

    expect(state.phase.kind).toBe('encounter')
    if (state.phase.kind === 'encounter') {
      expect(state.phase.encounter.awaitingDefence).toBe(true)
    }
  })

  it('does not ask when none of our players are involved', () => {
    const state = newMatch('theirs')
    const carrier = find(state, 'home:wakka')
    giveBallTo(state, carrier)
    carrier.x = 0
    carrier.y = 0
    for (const opponent of state.players.filter((p) => p.team === 'away' && p.slot !== 'GK')) {
      opponent.x = ENGAGE_RADIUS - 1
      opponent.y = 0
    }
    state.engageCooldown = 0
    state.phase = { kind: 'play' }

    stepMatch(state, TICK)
    const phase = phaseOf(state)
    expect(phase.kind).toBe('encounter')
    if (phase.kind === 'encounter') {
      expect(phase.encounter.awaitingDefence).toBe(false)
    }
  })

  it('holds the carrier until the defence has answered', () => {
    const state = newMatch('hold')
    runAtUs(state, ['home:letty'])
    stepMatch(state, TICK)

    // The opposing carrier would otherwise commit after its think timer.
    for (let i = 0; i < 120; i++) stepMatch(state, TICK)
    expect(state.phase.kind).toBe('encounter')

    submitDefence(state, null)
    for (let i = 0; i < 120; i++) stepMatch(state, TICK)
    expect(state.phase.kind).not.toBe('encounter')
  })

  it('refuses an action on the ball while the defence is still deciding', () => {
    const state = newMatch('busy')
    runAtUs(state, ['home:letty'])
    stepMatch(state, TICK)

    expect(submitEncounterAction(state, { kind: 'breakthrough', breakPast: 2 })).toBe(false)
  })

  it('ignores an answer when nothing is being asked', () => {
    const state = newMatch('nothing')
    expect(submitDefence(state, null)).toBe(false)
  })

  it('answers only once', () => {
    const state = newMatch('once')
    runAtUs(state, ['home:letty'])
    stepMatch(state, TICK)

    expect(submitDefence(state, 'venom-tackle')).toBe(true)
    expect(submitDefence(state, null)).toBe(false)
  })
})

describe('what the defence can bring', () => {
  it('offers the techniques its engaged defenders know', () => {
    const state = newMatch('offer')
    runAtUs(state, ['home:letty'])
    const carrier = find(state, 'away:bickson')
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))

    // Letty knows Venom Tackle.
    expect(defensiveTechniques(state, encounter).map((t) => t.id)).toContain('venom-tackle')
  })

  it('offers nothing from defenders who are not involved', () => {
    const state = newMatch('uninvolved')
    runAtUs(state, ['home:tidus'])
    const carrier = find(state, 'away:bickson')
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))

    // Tidus has no tackle technique; Letty's is not on offer because she is
    // nowhere near the play.
    expect(defensiveTechniques(state, encounter)).toEqual([])
  })

  it('leaves out anything the defender cannot pay for', () => {
    const state = newMatch('broke')
    runAtUs(state, ['home:letty'])
    find(state, 'home:letty').hp = 1

    const carrier = find(state, 'away:bickson')
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    expect(defensiveTechniques(state, encounter)).toEqual([])
  })

  it('lists each technique once even when several defenders know it', () => {
    const state = newMatch('dupes')
    runAtUs(state, ['home:letty', 'home:jassu'])
    const carrier = find(state, 'away:bickson')
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))

    const ids = defensiveTechniques(state, encounter).map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('the chosen tackle', () => {
  it('fires when the defender who wins the ball knows it', () => {
    const state = newMatch('fires')
    const carrier = runAtUs(state, ['home:letty'])
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.awaitingDefence = false
    encounter.defence = { techniqueId: 'venom-tackle' }
    encounter.endurance = 1
    state.endurance = 1

    const result = resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })

    expect(result.success).toBe(false)
    expect(result.summary).toContain('Venom Tackle')
    expect(hasStatus(carrier, 'poison')).toBe(true)
  })

  it('is a plain tackle when the one who got there does not know it', () => {
    const state = newMatch('plain')
    const carrier = runAtUs(state, ['home:tidus'])
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.awaitingDefence = false
    // Chosen before the rolls, and it landed on someone who cannot do it.
    encounter.defence = { techniqueId: 'venom-tackle' }
    encounter.endurance = 1
    state.endurance = 1

    const result = resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })

    expect(result.summary).not.toContain('Venom Tackle')
    expect(hasStatus(carrier, 'poison')).toBe(false)
  })

  it('leaves the carrier alone when a plain tackle was chosen', () => {
    const state = newMatch('nothing-chosen')
    const carrier = runAtUs(state, ['home:letty'])
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.awaitingDefence = false
    encounter.defence = { techniqueId: null }
    encounter.endurance = 1
    state.endurance = 1

    resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })
    // A plain tackle is a real choice, not a fallback to whatever they know.
    expect(hasStatus(carrier, 'poison')).toBe(false)
  })
})

describe('when the AI defends', () => {
  it('brings a technique of its own without being asked', () => {
    const state = newMatch('ai-defends')
    const carrier = find(state, 'home:wakka')
    carrier.x = 0
    carrier.y = 0
    giveBallTo(state, carrier)

    const doram = find(state, 'away:doram')
    doram.x = ENGAGE_RADIUS - 1
    doram.y = 0
    for (const other of state.players.filter((p) => p.team === 'away' && p.id !== doram.id)) {
      other.x = 90
      other.y = 60
    }

    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    expect(encounter.awaitingDefence).toBe(false)
    encounter.endurance = 1
    state.endurance = 1

    const result = resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })
    // Doram knows Venom Tackle and nobody had to pick it for him.
    expect(result.summary).toContain('Venom Tackle')
  })

  it('picks something it can afford when asked to choose', () => {
    const state = newMatch('ai-picks')
    const carrier = runAtUs(state, ['home:letty'])
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))

    expect(chooseTackleTechnique(state, encounter)).toBe('venom-tackle')
  })
})
