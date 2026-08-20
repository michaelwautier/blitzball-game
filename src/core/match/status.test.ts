import { describe, expect, it } from 'vitest'
import { applyStatus, hasStatus, statusLabels, tickStatuses, witherFactor } from './status'
import { ASLEEP_FACTOR, EXHAUSTED_FACTOR, canAfford, effectiveStat, isAsleep, isExhausted, spendHp } from './stats'
import { createMatch } from './state'
import type { MatchState, Player } from './types'
import { BESAID_AUROCHS, LUCA_GOERS } from '../../data/teams'

const newMatch = (seed = 'status') => createMatch(BESAID_AUROCHS, LUCA_GOERS, seed)

function find(state: MatchState, id: string): Player {
  const player = state.players.find((p) => p.id === id)
  if (!player) throw new Error(`no player ${id}`)
  return player
}

describe('conditions', () => {
  it('starts everyone clean', () => {
    const state = newMatch()
    for (const player of state.players) expect(player.statuses).toEqual([])
  })

  it('applies and expires a condition on its timer', () => {
    const player = find(newMatch(), 'home:tidus')
    applyStatus(player, { kind: 'sleep', duration: 2, magnitude: 1 })
    expect(hasStatus(player, 'sleep')).toBe(true)

    tickStatuses(player, 1)
    expect(hasStatus(player, 'sleep')).toBe(true)

    tickStatuses(player, 1.5)
    expect(hasStatus(player, 'sleep')).toBe(false)
  })

  it('refreshes rather than stacks a repeated condition', () => {
    const player = find(newMatch(), 'home:tidus')
    applyStatus(player, { kind: 'poison', duration: 5, magnitude: 3 })
    applyStatus(player, { kind: 'poison', duration: 5, magnitude: 3 })
    expect(player.statuses).toHaveLength(1)
  })

  it('keeps the longer timer and stronger magnitude when refreshed', () => {
    const player = find(newMatch(), 'home:tidus')
    applyStatus(player, { kind: 'poison', duration: 10, magnitude: 5 })
    applyStatus(player, { kind: 'poison', duration: 2, magnitude: 1 })

    const poison = player.statuses[0]!
    expect(poison.remaining).toBe(10)
    expect(poison.magnitude).toBe(5)
  })

  it('treats withers on different stats as separate conditions', () => {
    const player = find(newMatch(), 'home:tidus')
    applyStatus(player, { kind: 'wither', duration: 5, magnitude: 0.4, stat: 'en' })
    applyStatus(player, { kind: 'wither', duration: 5, magnitude: 0.4, stat: 'bl' })
    expect(player.statuses).toHaveLength(2)
  })

  it('drains HP over time while poisoned', () => {
    const player = find(newMatch(), 'home:tidus')
    const before = player.hp
    applyStatus(player, { kind: 'poison', duration: 10, magnitude: 4 })
    tickStatuses(player, 2)
    expect(player.hp).toBeCloseTo(before - 8, 5)
  })

  it('never drains HP below zero', () => {
    const player = find(newMatch(), 'home:tidus')
    player.hp = 3
    applyStatus(player, { kind: 'poison', duration: 10, magnitude: 100 })
    tickStatuses(player, 1)
    expect(player.hp).toBe(0)
  })

  it('labels each condition for the pitch', () => {
    const player = find(newMatch(), 'home:tidus')
    applyStatus(player, { kind: 'poison', duration: 5, magnitude: 1 })
    applyStatus(player, { kind: 'sleep', duration: 5, magnitude: 1 })
    applyStatus(player, { kind: 'wither', duration: 5, magnitude: 0.4, stat: 'en' })
    expect(statusLabels(player)).toEqual(['PSN', 'ZZZ', 'EN↓'])
  })
})

describe('effective stats', () => {
  it('returns the base stat for a healthy player', () => {
    const player = find(newMatch(), 'home:wakka')
    expect(effectiveStat(player, 'sh')).toBe(player.def.stats.sh)
  })

  it('saps the withered stat and leaves the others alone', () => {
    const player = find(newMatch(), 'home:wakka')
    const en = player.def.stats.en
    applyStatus(player, { kind: 'wither', duration: 10, magnitude: 0.5, stat: 'en' })

    expect(effectiveStat(player, 'en')).toBe(Math.round(en * 0.5))
    expect(effectiveStat(player, 'sh')).toBe(player.def.stats.sh)
  })

  it('compounds two withers on the same stat', () => {
    const player = find(newMatch(), 'home:wakka')
    applyStatus(player, { kind: 'wither', duration: 10, magnitude: 0.5, stat: 'en' })
    // Same kind and stat refreshes rather than stacking, so force a second entry.
    player.statuses.push({ kind: 'wither', duration: 10, magnitude: 0.5, stat: 'en', remaining: 10 })
    expect(witherFactor(player, 'en')).toBeCloseTo(0.25, 5)
  })

  it('halves everything for an exhausted player', () => {
    const player = find(newMatch(), 'home:wakka')
    player.hp = 0
    expect(isExhausted(player)).toBe(true)
    expect(effectiveStat(player, 'sh')).toBe(
      Math.round(player.def.stats.sh * EXHAUSTED_FACTOR),
    )
  })

  it('leaves a sleeping keeper barely able to catch', () => {
    const player = find(newMatch(), 'away:raudy')
    applyStatus(player, { kind: 'sleep', duration: 5, magnitude: 1 })
    expect(isAsleep(player)).toBe(true)
    expect(effectiveStat(player, 'ca')).toBe(Math.round(player.def.stats.ca * ASLEEP_FACTOR))
  })

  it('never reduces a real stat to nothing', () => {
    const player = find(newMatch(), 'home:datto')
    player.hp = 0
    applyStatus(player, { kind: 'sleep', duration: 5, magnitude: 1 })
    applyStatus(player, { kind: 'wither', duration: 5, magnitude: 0.9, stat: 'sh' })
    expect(effectiveStat(player, 'sh')).toBeGreaterThanOrEqual(1)
  })
})

describe('stamina', () => {
  it('spends HP without going negative', () => {
    const player = find(newMatch(), 'home:tidus')
    player.hp = 5
    spendHp(player, 20)
    expect(player.hp).toBe(0)
  })

  it('knows what a player can afford', () => {
    const player = find(newMatch(), 'home:tidus')
    player.hp = 20
    expect(canAfford(player, 20)).toBe(true)
    expect(canAfford(player, 21)).toBe(false)
  })
})
