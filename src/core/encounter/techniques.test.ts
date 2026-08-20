import { describe, expect, it } from 'vitest'
import { ENGAGE_RADIUS, engagingDefenders, openEncounter, resolveEncounter } from './encounter'
import { ACTION_HP_COST } from './formulas'
import { createMatch, stepMatch } from '../match/state'
import { giveBallTo } from '../match/possession'
import { hasStatus } from '../match/status'
import type { MatchState, Player } from '../match/types'
import { TECHNIQUES, findTechnique, techniquesOf } from '../../data/techniques'
import { GOAL_X } from '../pitch'
import { BESAID_AUROCHS, LUCA_GOERS, TEAMS } from '../../data/teams'

const TICK = 1 / 60
const newMatch = (seed = 'tech') => createMatch(BESAID_AUROCHS, LUCA_GOERS, seed)

function find(state: MatchState, id: string): Player {
  const player = state.players.find((p) => p.id === id)
  if (!player) throw new Error(`no player ${id}`)
  return player
}

/** Put a carrier at the centre with `count` opponents on top of them. */
function setUpEncounter(state: MatchState, carrierId: string, count: number): Player {
  const carrier = find(state, carrierId)
  carrier.x = 0
  carrier.y = 0
  giveBallTo(state, carrier)

  state.players
    .filter((p) => p.team !== carrier.team && p.slot !== 'GK')
    .forEach((defender, index) => {
      const inRange = index < count
      defender.x = inRange ? ENGAGE_RADIUS - 1 : 40
      defender.y = inRange ? index * 0.5 : 40
    })

  return carrier
}

describe('technique data', () => {
  it('has unique ids', () => {
    expect(new Set(TECHNIQUES.map((t) => t.id)).size).toBe(TECHNIQUES.length)
  })

  it('charges HP for every technique', () => {
    for (const technique of TECHNIQUES) {
      expect(technique.hpCost, technique.name).toBeGreaterThan(0)
    }
  })

  it('only ever grants blocker immunity to shots and passes', () => {
    for (const technique of TECHNIQUES) {
      if (technique.kind === 'tackle') expect(technique.ignoresBlockers).toBe(0)
    }
  })

  it('gives every rostered technique a definition', () => {
    for (const team of TEAMS) {
      for (const player of team.roster) {
        for (const id of player.techniques) {
          expect(() => findTechnique(id), `${player.name} knows ${id}`).not.toThrow()
        }
      }
    }
  })

  it('only gives players techniques for actions they can take', () => {
    for (const team of TEAMS) {
      for (const player of team.roster) {
        // A keeper never dribbles into an encounter, so shoot and pass
        // techniques on one would be unusable.
        if (player.natural !== 'GK') continue
        expect(techniquesOf(player.techniques, 'shoot')).toHaveLength(0)
      }
    }
  })

  it('throws helpfully for an unknown technique', () => {
    expect(() => findTechnique('nonsense')).toThrow(/nonsense/)
  })
})

describe('spending stamina', () => {
  it('charges the base cost for a plain breakthrough', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:wakka', 1)
    const before = carrier.hp
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.endurance = 100

    resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })
    expect(carrier.hp).toBe(before - ACTION_HP_COST.breakthrough)
  })

  it('charges the base cost plus the technique', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:wakka', 1)
    const before = carrier.hp
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))

    resolveEncounter(state, encounter, { kind: 'shoot', techniqueId: 'venom-shot' })

    const venom = findTechnique('venom-shot')
    expect(carrier.hp).toBe(before - ACTION_HP_COST.shoot - venom.hpCost)
  })

  it('falls back to the plain action when the technique is unaffordable', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:wakka', 1)
    carrier.hp = ACTION_HP_COST.shoot + 1
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))

    const result = resolveEncounter(state, encounter, { kind: 'shoot', techniqueId: 'venom-shot' })

    // Still a shot, just without the technique's name or its cost.
    expect(result.success).toBe(true)
    expect(result.summary).not.toContain('Venom Shot')
    expect(carrier.hp).toBe(1)
  })

  it('refuses a technique the player has not learned', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:datto', 1)
    const before = carrier.hp
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))

    resolveEncounter(state, encounter, { kind: 'shoot', techniqueId: 'jecht-shot' })
    expect(carrier.hp).toBe(before - ACTION_HP_COST.shoot)
  })

  it('refuses a technique belonging to the wrong action', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 1)
    const before = carrier.hp
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))

    // Tidus knows Wither Pass, but it is not a shooting technique.
    resolveEncounter(state, encounter, { kind: 'shoot', techniqueId: 'wither-pass' })
    expect(carrier.hp).toBe(before - ACTION_HP_COST.shoot)
  })

  it('recovers stamina for players not carrying the ball', () => {
    const state = newMatch('regen')
    const resting = find(state, 'home:datto')
    resting.hp = 50
    for (let i = 0; i < 300; i++) stepMatch(state, TICK)
    expect(resting.hp).toBeGreaterThan(50)
  })
})

describe('technique effects', () => {
  it('poisons the keeper with a Venom Shot, saved or not', () => {
    const state = newMatch('venom')
    const carrier = setUpEncounter(state, 'home:wakka', 1)
    // Close enough that the shot still has power when it arrives: a shot that
    // runs out on the way never reaches the keeper to poison them.
    carrier.x = GOAL_X - 12
    // The ball rides with its carrier during play, but this resolves an
    // encounter directly, so it has to be brought along by hand — otherwise the
    // shot sets off from the centre spot and expires before reaching the goal.
    state.ball.x = carrier.x
    state.ball.y = carrier.y

    const keeper = find(state, 'away:raudy')
    expect(hasStatus(keeper, 'poison')).toBe(false)

    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    resolveEncounter(state, encounter, { kind: 'shoot', techniqueId: 'venom-shot' })
    for (let i = 0; i < 240 && state.phase.kind === 'flight'; i++) stepMatch(state, TICK)

    expect(hasStatus(keeper, 'poison')).toBe(true)
  })

  it('waves a Jecht Shot past blockers who would otherwise slow it', () => {
    const state = newMatch('jecht')
    const carrier = setUpEncounter(state, 'home:tidus', 0)
    carrier.x = 20
    carrier.y = 0

    const encounter = openEncounter(state, carrier, [])
    resolveEncounter(state, encounter, { kind: 'shoot', techniqueId: 'jecht-shot' })

    expect(state.phase.kind).toBe('flight')
    if (state.phase.kind === 'flight') {
      expect(state.phase.flight.blockersIgnored).toBe(2)
      expect(state.phase.flight.technique?.id).toBe('jecht-shot')
    }
  })

  it('poisons the defenders a Venom Pass is threaded past', () => {
    const state = newMatch('venom-pass')
    const passer = find(state, 'home:wakka')
    const receiver = find(state, 'home:tidus')
    receiver.x = 20
    receiver.y = 0

    const blocker = setUpEncounter(state, 'home:wakka', 1) && find(state, 'away:doram')
    blocker.x = ENGAGE_RADIUS - 1
    blocker.y = 0
    const engaged = engagingDefenders(state, passer)
    expect(engaged.length).toBeGreaterThan(0)

    const encounter = openEncounter(state, passer, engaged)
    resolveEncounter(state, encounter, { kind: 'pass', targetId: receiver.id, techniqueId: 'venom-pass' })

    // Every defender who tried to cut it out is poisoned, whether or not they did.
    for (const defender of engaged) expect(hasStatus(defender, 'poison')).toBe(true)
  })

  it('fires a tackle technique automatically when the ball is won back', () => {
    const state = newMatch('tackle-tech')
    const carrier = setUpEncounter(state, 'home:tidus', 1)
    // Doram is the only defender engaged, and knows Venom Tackle.
    const doram = find(state, 'away:doram')
    doram.x = ENGAGE_RADIUS - 1
    doram.y = 0
    for (const other of state.players.filter((p) => p.team === 'away' && p.id !== doram.id)) {
      other.x = 45
      other.y = 45
    }

    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.endurance = 1

    const result = resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })

    expect(result.success).toBe(false)
    expect(state.ball.carrier).toBe(doram.id)
    expect(hasStatus(carrier, 'poison')).toBe(true)
    expect(result.summary).toContain('Venom Tackle')
  })

  it('does not fire a tackle technique the defender cannot pay for', () => {
    const state = newMatch('broke-tackler')
    const carrier = setUpEncounter(state, 'home:tidus', 1)
    const doram = find(state, 'away:doram')
    doram.x = ENGAGE_RADIUS - 1
    doram.y = 0
    doram.hp = 1
    for (const other of state.players.filter((p) => p.team === 'away' && p.id !== doram.id)) {
      other.x = 45
      other.y = 45
    }

    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.endurance = 1
    resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })

    expect(hasStatus(carrier, 'poison')).toBe(false)
  })

  it('reads a withered stat when the encounter opens', () => {
    const state = newMatch('withered')
    const carrier = setUpEncounter(state, 'home:tidus', 1)
    const defender = engagingDefenders(state, carrier)[0]!

    const healthy = openEncounter(state, carrier, [defender]).defenders[0]!.attack
    defender.statuses.push({
      kind: 'wither',
      duration: 10,
      magnitude: 0.6,
      stat: 'at',
      remaining: 10,
    })
    const withered = openEncounter(state, carrier, [defender]).defenders[0]!.attack

    // Rolls vary, but a 60% sapping must show through the noise.
    expect(withered).toBeLessThan(healthy)
  })
})
