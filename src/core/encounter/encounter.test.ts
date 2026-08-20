import { describe, expect, it } from 'vitest'
import { ENGAGE_RADIUS, engagingDefenders, openEncounter, resolveEncounter } from './encounter'
import { createMatch } from '../match/state'
import { giveBallTo } from '../match/possession'
import type { MatchState, Player } from '../match/types'
import { BESAID_AUROCHS, LUCA_GOERS } from '../../data/teams'

const newMatch = (seed = 'enc') => createMatch(BESAID_AUROCHS, LUCA_GOERS, seed)

function find(state: MatchState, id: string): Player {
  const player = state.players.find((p) => p.id === id)
  if (!player) throw new Error(`no player ${id}`)
  return player
}

/** Put a carrier at the centre with `count` opponents right on top of them. */
function setUpEncounter(state: MatchState, carrierId: string, count: number): Player {
  const carrier = find(state, carrierId)
  carrier.x = 0
  carrier.y = 0
  giveBallTo(state, carrier)

  const opponents = state.players.filter((p) => p.team !== carrier.team && p.slot !== 'GK')
  opponents.forEach((defender, index) => {
    // Inside the engage radius for the first `count`, far away for the rest.
    const inRange = index < count
    defender.x = inRange ? ENGAGE_RADIUS - 1 : 40
    defender.y = inRange ? index * 0.5 : 40
  })

  return carrier
}

describe('engagement', () => {
  it('engages only opponents within reach', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 2)
    expect(engagingDefenders(state, carrier)).toHaveLength(2)
  })

  it('never engages the keeper, who defends the line instead', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 0)
    const keeper = find(state, 'away:raudy')
    keeper.x = 0
    keeper.y = 1
    expect(engagingDefenders(state, carrier)).toHaveLength(0)
  })

  it('never engages teammates', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 0)
    for (const mate of state.players.filter((p) => p.team === 'home' && p.id !== carrier.id)) {
      mate.x = 0
      mate.y = 0
    }
    expect(engagingDefenders(state, carrier)).toHaveLength(0)
  })

  it('orders defenders by how close they are', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 3)
    const engaged = engagingDefenders(state, carrier)
    const distances = engaged.map((d) => Math.hypot(d.x - carrier.x, d.y - carrier.y))
    expect([...distances].sort((a, b) => a - b)).toEqual(distances)
  })
})

describe('opening an encounter', () => {
  it('rolls each defender s attack once and holds it', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 2)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))

    expect(encounter.defenders).toHaveLength(2)
    for (const defender of encounter.defenders) {
      const player = find(state, defender.id)
      // Rolled upward from the base stat, so never below it.
      expect(defender.attack).toBeGreaterThanOrEqual(player.def.stats.at)
    }

    // The snapshot must not drift when read again.
    const first = encounter.defenders.map((d) => d.attack)
    expect(encounter.defenders.map((d) => d.attack)).toEqual(first)
  })

  it('captures the endurance left in the current possession', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 1)
    state.endurance = 5
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    expect(encounter.endurance).toBe(5)
  })
})

describe('breakthrough', () => {
  it('succeeds and keeps the ball when endurance survives', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:wakka', 1)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.endurance = 100

    const result = resolveEncounter(state, encounter, { kind: 'breakthrough' })

    expect(result.success).toBe(true)
    expect(state.ball.carrier).toBe(carrier.id)
    expect(state.engageCooldown).toBeGreaterThan(0)
  })

  it('drains endurance by the tackle it faced', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:wakka', 2)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.endurance = 100
    const attack = encounter.defenders.reduce((sum, d) => sum + d.attack, 0)

    resolveEncounter(state, encounter, { kind: 'breakthrough' })

    expect(state.endurance).toBe(100 - attack)
  })

  it('loses the ball to the strongest tackler when endurance runs out', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 2)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.endurance = 1

    const strongest = encounter.defenders.reduce((best, d) => (d.attack > best.attack ? d : best))
    const result = resolveEncounter(state, encounter, { kind: 'breakthrough' })

    expect(result.success).toBe(false)
    expect(state.ball.carrier).toBe(strongest.id)
    expect(state.endurance).toBe(find(state, strongest.id).def.stats.en)
  })

  it('never leaves endurance negative', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 3)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.endurance = 1
    resolveEncounter(state, encounter, { kind: 'breakthrough' })
    expect(state.endurance).toBeGreaterThanOrEqual(0)
  })

  it('reports the arithmetic it used', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:wakka', 1)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.endurance = 30
    const attack = encounter.defenders[0]!.attack

    const result = resolveEncounter(state, encounter, { kind: 'breakthrough' })
    expect(result.summary).toContain(`EN 30 − AT ${attack}`)
  })
})

describe('pass and shoot', () => {
  it('sends the ball into flight towards the chosen teammate', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 1)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))

    const result = resolveEncounter(state, encounter, { kind: 'pass', targetId: 'home:wakka', techniqueId: null })

    expect(result.success).toBe(true)
    expect(state.ball.carrier).toBeNull()
    expect(state.phase.kind).toBe('flight')
    if (state.phase.kind === 'flight') {
      expect(state.phase.flight.kind).toBe('pass')
      expect(state.phase.flight.targetId).toBe('home:wakka')
    }
  })

  it('refuses to pass to an opponent', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 1)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))

    const result = resolveEncounter(state, encounter, { kind: 'pass', targetId: 'away:bickson', techniqueId: null })

    expect(result.success).toBe(false)
    expect(state.ball.carrier).toBe(carrier.id)
    expect(state.phase.kind).not.toBe('flight')
  })

  it('sends a shot into flight at the goal', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:wakka', 1)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))

    resolveEncounter(state, encounter, { kind: 'shoot', techniqueId: null })

    expect(state.phase.kind).toBe('flight')
    if (state.phase.kind === 'flight') {
      expect(state.phase.flight.kind).toBe('shot')
      // Home defends the left goal, so it shoots at the right one.
      expect(state.phase.flight.target.x).toBeGreaterThan(0)
    }
  })

  it('survives the carrier disappearing mid-encounter', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 1)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.carrierId = 'nobody'

    const result = resolveEncounter(state, encounter, { kind: 'breakthrough' })
    expect(result.success).toBe(false)
  })
})
