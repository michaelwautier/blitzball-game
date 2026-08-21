import { describe, expect, it } from 'vitest'
import {
  ENGAGE_RADIUS,
  LUNGE_SECONDS,
  MAX_ENGAGED,
  blockRange,
  engagingDefenders,
  openEncounter,
  passReach,
  resolveEncounter,
  tackleRange,
} from './encounter'
import { passDecay, rollBounds } from './formulas'
import { createMatch, stepMatch } from '../match/state'
import { effectiveStat } from '../match/stats'
import { POOL_RADIUS } from '../pitch'
import { giveBallTo } from '../match/possession'
import type { Encounter, MatchState, Player } from '../match/types'
import { BESAID_AUROCHS, LUCA_GOERS } from '../../data/teams'
import { bestPassTarget } from '../ai/decisions'
import { attackDirection } from '../match/formation'

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

  it('lets only two onto the carrier, however many are in reach', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 5)
    expect(engagingDefenders(state, carrier)).toHaveLength(MAX_ENGAGED)
  })

  it('picks the two nearest when a crowd arrives', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 0)

    const opponents = state.players.filter((p) => p.team === 'away' && p.slot !== 'GK')
    // Deliberately in the opposite order to the players array, so passing this
    // means it sorted rather than simply taking the first two it found.
    opponents.forEach((defender, index) => {
      defender.x = 1 + (opponents.length - index) * 0.4
      defender.y = 0
    })

    const engaged = engagingDefenders(state, carrier).map((d) => d.id)
    expect(engaged).toEqual([opponents.at(-1)!.id, opponents.at(-2)!.id])
  })
})

describe('how much blocking gets counted', () => {
  /** A stand-in encounter with the given blocking stats, closest first. */
  const withBlockers = (...blocks: number[]) =>
    blocks.map((block, index) => ({ id: `d${index}`, attack: 0, block }))

  it('counts the nearest defender in full', () => {
    const one = blockRange(withBlockers(10))
    expect(one).toEqual(rollBounds(10))
  })

  it('counts the second at half, being behind the first', () => {
    const alone = blockRange(withBlockers(10))
    const pair = blockRange(withBlockers(10, 10))
    // Two bodies do not block twice as much of an open ring.
    expect(pair.max).toBeLessThan(alone.max * 2)
    expect(pair.max).toBeGreaterThan(alone.max)
  })

  /**
   * The range the menu quotes has to be the range that gets rolled.
   *
   * A shot carrying more than the advertised worst case must always survive the
   * blocking, and one carrying less than the advertised best case must always be
   * stopped by it. Anything else means the odds shown to a player, and the odds
   * the AI reasons about, are not the odds being played.
   */
  const shootWith = (sh: number, seed: string) => {
    const state = newMatch(seed)
    const carrier = setUpEncounter(state, 'home:tidus', 2)
    carrier.stats.sh = sh

    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    const range = blockRange(encounter.defenders)
    const results = Array.from({ length: 300 }, () => {
      giveBallTo(state, carrier)
      // Three hundred shots would otherwise leave him spent, and an exhausted
      // player throws at half strength — which is a different test.
      carrier.hp = carrier.def.stats.hp
      return resolveEncounter(state, { ...encounter, endurance: 1000 }, {
        kind: 'shoot',
        techniqueId: null
      })
    })
    return { range, results }
  }

  it('never blocks a throw carrying more than the range quoted', () => {
    const { range, results } = shootWith(0, 'over')
    const { results: strong } = shootWith(range.max + 1, 'over')
    expect(strong.every((r) => r.success)).toBe(true)
    // And the weak one is there to prove the fixture can block at all.
    expect(results.some((r) => !r.success)).toBe(true)
  })

  it('always blocks a throw carrying less than the range quoted', () => {
    const { range } = shootWith(1, 'under')
    expect(range.min).toBeGreaterThan(0)
    const { results } = shootWith(1, 'under')
    expect(results.every((r) => !r.success)).toBe(true)
  })
})

describe('staging the encounter', () => {
  it('brings every engaged defender round in front of the carrier', () => {
    const state = newMatch('stage')
    const carrier = setUpEncounter(state, 'home:wakka', 2)
    const engaged = engagingDefenders(state, carrier)
    // Start them behind, so being in front afterwards means they were moved.
    for (const defender of engaged) defender.x = carrier.x - 3

    openEncounter(state, carrier, engaged)

    const forward = Math.sign(carrier.x) || 1
    for (const defender of engaged) {
      expect(defender.lunge, `${defender.def.name} was not staged`).not.toBeNull()
      const goalSide = Math.sign(defender.lunge!.toX - carrier.x) === forward
      expect(goalSide, `${defender.def.name} was staged behind`).toBe(true)
    }
  })

  it('fans them apart rather than stacking them on one spot', () => {
    const state = newMatch('fan')
    const carrier = setUpEncounter(state, 'home:wakka', 2)
    const engaged = engagingDefenders(state, carrier)
    openEncounter(state, carrier, engaged)

    const [first, second] = engaged
    expect(first!.lunge!.toY).not.toBe(second!.lunge!.toY)
  })

  it('travels there rather than teleporting', () => {
    const state = newMatch('travel')
    const carrier = setUpEncounter(state, 'home:wakka', 1)
    const engaged = engagingDefenders(state, carrier)
    const before = { x: engaged[0]!.x, y: engaged[0]!.y }

    openEncounter(state, carrier, engaged)
    // Committed, not applied: the body has not moved yet.
    expect({ x: engaged[0]!.x, y: engaged[0]!.y }).toEqual(before)
  })

  it('keeps everyone inside the pool, even against the wall', () => {
    const state = newMatch('wall')
    const carrier = setUpEncounter(state, 'home:wakka', 2)
    carrier.y = POOL_RADIUS * 0.97
    const engaged = engagingDefenders(state, carrier)
    openEncounter(state, carrier, engaged)

    for (const defender of engaged) {
      const spot = defender.lunge!
      expect(Math.hypot(spot.toX, spot.toY)).toBeLessThanOrEqual(POOL_RADIUS)
    }
  })

  it('plays the staging out while the menu is open', () => {
    // The world is frozen during an encounter, but a committed movement is not.
    const state = newMatch('staging-runs')
    const carrier = setUpEncounter(state, 'home:wakka', 1)
    giveBallTo(state, carrier)
    const defender = engagingDefenders(state, carrier)[0]!
    state.phase = {
      kind: 'encounter',
      encounter: openEncounter(state, carrier, [defender]),
    }
    const destination = { x: defender.lunge!.toX, y: defender.lunge!.toY }

    for (let i = 0; i < 60; i++) stepMatch(state, 1 / 60)

    expect(defender.lunge).toBeNull()
    expect(defender.x).toBeCloseTo(destination.x, 3)
    expect(defender.y).toBeCloseTo(destination.y, 3)
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

    const result = resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })

    expect(result.success).toBe(true)
    expect(state.ball.carrier).toBe(carrier.id)
    expect(state.engageCooldown).toBeGreaterThan(0)
  })

  it('drains endurance by the tackles it faced', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:wakka', 2)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.endurance = 100

    const { min, max } = tackleRange(encounter.defenders)
    resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })

    // Each tackle is rolled when it is made, so the drain lands somewhere in the
    // range the menu advertised rather than on an exact figure.
    expect(state.endurance).toBeLessThanOrEqual(100 - min)
    expect(state.endurance).toBeGreaterThanOrEqual(100 - max)
  })

  it('has every engaged defender put a tackle in', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:wakka', 2)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.endurance = 100

    const result = resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })

    // Two defenders, so two subtractions in the summary.
    expect(result.summary.match(/−/g)).toHaveLength(2)
  })

  it('stops once the ball is dislodged rather than piling on', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 3)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.endurance = 1

    const result = resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })

    // The first tackle takes it; the others never needed to commit.
    expect(result.success).toBe(false)
    expect(result.summary.match(/−/g)).toHaveLength(1)
  })

  it('gives the ball to whoever took the endurance to zero', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 2)
    const engaged = engagingDefenders(state, carrier)
    const encounter = openEncounter(state, carrier, engaged)
    encounter.endurance = 1

    resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })

    // Closest defender tackles first, so with one point of endurance it is theirs.
    expect(state.ball.carrier).toBe(engaged[0]!.id)
  })

  it('carries every defender who tackled past the carrier', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:wakka', 2)
    const engaged = engagingDefenders(state, carrier)
    const encounter = openEncounter(state, carrier, engaged)
    encounter.endurance = 100

    resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })

    // The challenge is a movement, not a jump: they are still in front at the
    // moment it is committed.
    for (const defender of engaged) expect(defender.lunge).not.toBeNull()

    for (let i = 0; i < Math.ceil(LUNGE_SECONDS * 60) + 2; i++) stepMatch(state, 1 / 60)

    // Home attacks +x, so behind the carrier is to their left.
    for (const defender of engaged) {
      expect(defender.x, `${defender.def.name}`).toBeLessThan(carrier.x)
      expect(defender.lunge, `${defender.def.name} still lunging`).toBeNull()
    }
  })

  it('travels there rather than jumping', () => {
    const state = newMatch('travel')
    const carrier = setUpEncounter(state, 'home:wakka', 1)
    const defender = engagingDefenders(state, carrier)[0]!
    const encounter = openEncounter(state, carrier, [defender])
    encounter.endurance = 100

    resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })
    const start = { x: defender.x, y: defender.y }

    // Sampled part way through, they are somewhere between the two ends — which
    // is what makes it something you can watch rather than a body blinking from
    // one side of the carrier to the other.
    for (let i = 0; i < Math.ceil(LUNGE_SECONDS * 30); i++) stepMatch(state, 1 / 60)

    const target = defender.lunge
    expect(target).not.toBeNull()
    const travelled = Math.hypot(defender.x - start.x, defender.y - start.y)
    const whole = Math.hypot(target!.toX - start.x, target!.toY - start.y)
    expect(travelled).toBeGreaterThan(0)
    expect(travelled).toBeLessThan(whole)
  })

  it('puts every beaten defender out of the play for a moment', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:wakka', 2)
    const engaged = engagingDefenders(state, carrier)
    const encounter = openEncounter(state, carrier, engaged)
    encounter.endurance = 100

    resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })

    for (const defender of engaged) {
      expect(defender.recovery, defender.def.name).toBeGreaterThan(0)
    }
  })

  it('will not let a defender still recovering start another encounter', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:wakka', 2)
    const engaged = engagingDefenders(state, carrier)
    expect(engaged.length).toBeGreaterThan(0)

    for (const defender of engaged) defender.recovery = 1
    // Put them right back on the carrier: proximity alone is not enough.
    for (const defender of engaged) {
      defender.x = carrier.x
      defender.y = carrier.y + 1
    }

    expect(engagingDefenders(state, carrier)).toHaveLength(0)
  })

  it('lets them back in once they have recovered', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:wakka', 2)
    const engaged = engagingDefenders(state, carrier)
    for (const defender of engaged) defender.recovery = 0.1

    for (let i = 0; i < 30; i++) stepMatch(state, 1 / 60)
    for (const defender of engaged) expect(defender.recovery).toBe(0)
  })

  it('holds a recovering defender still rather than letting them give chase', () => {
    const state = newMatch('held')
    const carrier = setUpEncounter(state, 'home:wakka', 1)
    const defender = engagingDefenders(state, carrier)[0]!
    defender.recovery = 1.5
    const where = { x: defender.x, y: defender.y }

    // Put the ball far away, so anything mobile would set off after it.
    state.ball.x = -60
    state.ball.y = 20
    for (let i = 0; i < 30; i++) stepMatch(state, 1 / 60)

    expect(Math.hypot(defender.x - where.x, defender.y - where.y)).toBeLessThan(1)
  })

  it('leaves the tackler behind the carrier too, having won the ball', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 1)
    const engaged = engagingDefenders(state, carrier)
    const encounter = openEncounter(state, carrier, engaged)
    encounter.endurance = 1

    // Where the carrier was when the challenge landed. Both players move on
    // afterwards — the tackler has the ball now — so the comparison has to be
    // against that moment rather than against wherever they end up.
    const dispossessedAt = carrier.x

    resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })
    for (let i = 0; i < Math.ceil(LUNGE_SECONDS * 60) + 2; i++) stepMatch(state, 1 / 60)

    expect(state.ball.carrier).toBe(engaged[0]!.id)
    expect(engaged[0]!.x).toBeLessThan(dispossessedAt)
  })

  it('does not leave the player who won the ball frozen holding it', () => {
    const state = newMatch('winner-free')
    const carrier = setUpEncounter(state, 'home:tidus', 1)
    const engaged = engagingDefenders(state, carrier)
    const encounter = openEncounter(state, carrier, engaged)
    encounter.endurance = 1

    resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })
    const winner = engaged[0]!

    // Carried past, as any challenge is — but not *beaten*, which is what
    // recovery means and what stops a player swimming at all.
    expect(state.ball.carrier).toBe(winner.id)
    expect(winner.lunge, 'the tackle had no momentum').not.toBeNull()
    expect(winner.recovery, 'the winner was frozen for winning').toBe(0)
  })

  it('still puts the defenders who lost the challenge out of the play', () => {
    const state = newMatch('losers-frozen')
    const carrier = setUpEncounter(state, 'home:tidus', 2)
    const engaged = engagingDefenders(state, carrier)
    const encounter = openEncounter(state, carrier, engaged)
    // Enough to survive the first challenge and be taken by the second.
    encounter.endurance = tackleRange(encounter.defenders.slice(0, 1)).max + 1

    resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })

    const winner = state.players.find((p) => p.id === state.ball.carrier)
    for (const defender of engaged) {
      if (defender.id === winner?.id) continue
      expect(defender.recovery, `${defender.def.name} was not put out`).toBeGreaterThan(0)
    }
  })

  it('lets the player who won it swim away with it', () => {
    // The whole point: win the ball, then actually go somewhere.
    const state = newMatch('swim-away')
    const carrier = setUpEncounter(state, 'home:tidus', 1)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.endurance = 1

    resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })
    const winner = state.players.find((p) => p.id === state.ball.carrier)!

    // Past the lunge, then half a second — well inside the window a beaten
    // defender would still be frozen for, which is what makes this a guard.
    for (let i = 0; i < Math.ceil(LUNGE_SECONDS * 60) + 2; i++) stepMatch(state, 1 / 60)
    const settled = { x: winner.x, y: winner.y }
    for (let i = 0; i < 30; i++) stepMatch(state, 1 / 60)

    expect(Math.hypot(winner.x - settled.x, winner.y - settled.y)).toBeGreaterThan(1)
  })

  it('loses the ball to the strongest tackler when endurance runs out', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 2)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.endurance = 1

    const strongest = encounter.defenders.reduce((best, d) => (d.attack > best.attack ? d : best))
    const result = resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })

    expect(result.success).toBe(false)
    expect(state.ball.carrier).toBe(strongest.id)
    expect(state.endurance).toBe(find(state, strongest.id).def.stats.en)
  })

  it('never leaves endurance negative', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 3)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.endurance = 1
    resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })
    expect(state.endurance).toBeGreaterThanOrEqual(0)
  })

  it('reports the arithmetic it used', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:wakka', 1)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.endurance = 30
    const attack = encounter.defenders[0]!.attack

    const result = resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })
    expect(result.summary).toMatch(/^EN 30 − \d+ = -?\d+/)
    expect(attack).toBeGreaterThan(0)
  })
})

describe('breaking past some of them', () => {
  /** A carrier with two on them and endurance to spare. */
  const twoOn = (seed: string, endurance = 300) => {
    const state = newMatch(seed)
    const carrier = setUpEncounter(state, 'home:wakka', 2)
    const engaged = engagingDefenders(state, carrier)
    const encounter = openEncounter(state, carrier, engaged)
    encounter.endurance = endurance
    state.endurance = endurance
    return { state, carrier, engaged, encounter }
  }

  it('leaves the carrier still caught, by whoever was not challenged', () => {
    const { state, encounter } = twoOn('partial')
    const second = encounter.defenders[1]!

    const result = resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 1 })

    expect(result.success).toBe(true)
    expect(result.continues).toBe(true)
    // Still an encounter, and now only the one who was left out of it.
    expect(encounter.defenders).toEqual([second])
  })

  it('frees the carrier only once everyone has been beaten', () => {
    const { state, encounter } = twoOn('all')
    const result = resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })

    expect(result.success).toBe(true)
    expect(result.continues).toBeFalsy()
    expect(state.engageCooldown).toBeGreaterThan(0)
  })

  it('carries only the defenders it took on past the carrier', () => {
    const { state, carrier, engaged, encounter } = twoOn('lunge')
    resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 1 })

    // Both have a lunge — everyone engaged was staged in front when the
    // encounter opened — so the difference is where it takes them, and who is
    // out of the play afterwards.
    const forward = Math.sign(carrier.x) || 1
    const challenged = engaged[0]!
    const untouched = engaged[1]!

    expect(challenged.recovery).toBeGreaterThan(0)
    expect(untouched.recovery).toBe(0)

    // The one challenged ends up behind the carrier; the other stays in front.
    const behind = (defender: typeof challenged) =>
      Math.sign(defender.lunge!.toX - carrier.x) !== forward
    expect(behind(challenged)).toBe(true)
    expect(behind(untouched)).toBe(false)
  })

  it('spends endurance only on the challenge it actually made', () => {
    const { state, encounter } = twoOn('cost', 200)
    const one = tackleRange(encounter.defenders.slice(0, 1))

    const result = resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 1 })

    const spent = result.summary.match(/^EN 200 − (\d+) =/)
    expect(spent, result.summary).not.toBeNull()
    expect(Number(spent![1])).toBeGreaterThanOrEqual(one.min)
    expect(Number(spent![1])).toBeLessThanOrEqual(one.max)
  })

  it('carries the shortened endurance into the decision that follows', () => {
    const { state, encounter } = twoOn('carry-en', 200)
    resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 1 })

    // Whatever survived the challenge is what the next choice is made against.
    expect(encounter.endurance).toBe(state.endurance)
    expect(encounter.endurance).toBeLessThan(200)
  })

  it('loses the ball outright when the challenge takes the endurance', () => {
    const { state, encounter } = twoOn('lost', 1)
    const result = resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 1 })

    expect(result.success).toBe(false)
    expect(result.continues).toBeFalsy()
    expect(result.summary).toContain('tackled by')
    const holder = state.players.find((p) => p.id === state.ball.carrier)
    expect(holder?.team).toBe('away')
  })

  it('names who was beaten, so the summary says what happened', () => {
    const { state, engaged, encounter } = twoOn('named')
    const result = resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 1 })
    expect(result.summary).toContain(engaged[0]!.def.name)
  })

  it('takes on at least one, and never more than are there', () => {
    for (const asked of [0, -3, 99]) {
      const { state, encounter } = twoOn(`clamp-${asked}`)
      expect(() =>
        resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: asked }),
      ).not.toThrow()
    }
  })
})

describe('a throw faces whoever is still on the carrier', () => {
  it('is contested by the defenders who remain', () => {
    const state = newMatch('throw-contested')
    const carrier = setUpEncounter(state, 'home:wakka', 2)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    carrier.stats.pa = 1

    // A pass with nothing behind it cannot survive two blockers.
    const result = resolveEncounter(state, encounter, {
      kind: 'pass',
      targetId: 'home:tidus',
      techniqueId: null,
    })
    expect(result.success).toBe(false)
  })

  it('flies once the carrier has broken past everyone', () => {
    const state = newMatch('throw-clear')
    const carrier = setUpEncounter(state, 'home:wakka', 2)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.endurance = 300
    state.endurance = 300

    // Break past both, then throw: nobody is left to cut it out.
    resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })
    const result = resolveEncounter(state, encounter, {
      kind: 'pass',
      targetId: 'home:tidus',
      techniqueId: null,
    })

    expect(result.success).toBe(true)
    expect(state.phase.kind).toBe('flight')
  })

  it('spends no endurance of its own', () => {
    // Breaking is where endurance goes now; throwing is not a challenge.
    const state = newMatch('throw-free')
    const carrier = setUpEncounter(state, 'home:wakka', 2)
    const encounter = openEncounter(state, carrier, engagingDefenders(state, carrier))
    encounter.endurance = 300
    state.endurance = 300

    const result = resolveEncounter(state, encounter, {
      kind: 'shoot',
      techniqueId: null,
    })
    expect(result.summary).not.toContain('EN ')
  })
})

describe('pass and shoot', () => {
  it('sends the ball into flight towards the chosen teammate', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:tidus', 0)
    // Nobody engaged, so nothing subtracts from the throw and it definitely flies.
    const encounter = openEncounter(state, carrier, [])

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
    const carrier = setUpEncounter(state, 'home:tidus', 0)
    const encounter = openEncounter(state, carrier, [])

    const result = resolveEncounter(state, encounter, { kind: 'pass', targetId: 'away:bickson', techniqueId: null })

    expect(result.success).toBe(false)
    expect(state.ball.carrier).toBe(carrier.id)
    expect(state.phase.kind).not.toBe('flight')
  })

  it('sends a shot into flight at the goal', () => {
    const state = newMatch()
    const carrier = setUpEncounter(state, 'home:wakka', 0)
    const encounter = openEncounter(state, carrier, [])

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

    const result = resolveEncounter(state, encounter, { kind: 'breakthrough', breakPast: 2 })
    expect(result.success).toBe(false)
  })
})

/**
 * PA is a range, and both the menu and the AI now ask it the same question.
 */
describe('how far a pass can reach', () => {
  it('shrinks as more of the defence gets in the way', () => {
    const state = newMatch()
    const carrier = find(state, 'home:datto')
    const clear = passReach(carrier, [])
    const blocked = passReach(carrier, [
      { id: 'away:doram', attack: 11, block: 6 },
      { id: 'away:balgerda', attack: 9, block: 8 },
    ])

    expect(blocked.max).toBeLessThan(clear.max)
    expect(blocked.min).toBeLessThanOrEqual(blocked.max)
  })

  it('is unlimited by nothing: an unmarked passer reaches exactly their PA', () => {
    const state = newMatch()
    const carrier = find(state, 'home:datto')
    const reach = passReach(carrier, [])

    // No defenders means no roll, so the whole band collapses to one distance.
    expect(reach.min).toBeCloseTo(reach.max)
    expect(reach.expected).toBeCloseTo(reach.max)
    expect(passDecay(reach.max)).toBeCloseTo(effectiveStat(carrier, 'pa'))
  })

  it('can be nothing at all when the blocking outweighs the passer', () => {
    const state = newMatch()
    const carrier = find(state, 'home:datto')
    const swamped = passReach(carrier, [{ id: 'away:doram', attack: 11, block: 99 }])

    expect(swamped.min).toBe(0)
  })
})

/**
 * The AI throwing balls that cannot arrive.
 *
 * Measured before this was fixed: across three hundred simulated matches, 3402
 * of the 10592 passes the AI chose were beyond even the best case of the
 * passer's range. Each one flew its whole distance, arrived spent, and was
 * fumbled straight to the opposition — a third of every pass in the league.
 */
describe('choosing someone the pass can reach', () => {
  /** Two defenders on the carrier, which is what cuts a good passer's range down. */
  const held = (carrier: Player): Encounter => ({
    kind: 'contested',
    carrierId: carrier.id,
    defenders: [
      { id: 'away:doram', attack: 11, block: 5 },
      { id: 'away:balgerda', attack: 9, block: 5 },
    ],
    endurance: 20,
    thinkTimer: 0,
    awaitingDefence: false,
    defence: null,
  })

  /** Letty on the ball at his own end, with the pitch laid out ahead of him. */
  function pinnedBack(state: MatchState): { carrier: Player; forward: number } {
    const carrier = find(state, 'home:letty')
    const forward = attackDirection(state.teams.home.defending)
    carrier.x = -forward * POOL_RADIUS * 0.9
    carrier.y = 0
    giveBallTo(state, carrier)
    return { carrier, forward }
  }

  it('will not pick a teammate beyond the throw', () => {
    const state = newMatch()
    const { carrier, forward } = pinnedBack(state)

    // Everyone upfield and out of reach: held by two, Letty's best case is
    // about 180 units and the far end of the pool is nearly 200 away.
    for (const mate of state.players.filter((p) => p.team === 'home' && p.id !== carrier.id)) {
      mate.x = forward * POOL_RADIUS * 0.9
      mate.y = 0
    }

    expect(bestPassTarget(state, carrier, held(carrier))).toBeUndefined()
  })

  it('still finds the one who is within it', () => {
    const state = newMatch()
    const { carrier, forward } = pinnedBack(state)

    for (const mate of state.players.filter((p) => p.team === 'home' && p.id !== carrier.id)) {
      mate.x = forward * POOL_RADIUS * 0.9
      mate.y = 0
    }
    // One teammate drops back into range, ahead of the ball but reachable.
    const outlet = find(state, 'home:tidus')
    outlet.x = carrier.x + forward * 40
    outlet.y = 0

    expect(bestPassTarget(state, carrier, held(carrier))?.id).toBe('home:tidus')
  })
})
