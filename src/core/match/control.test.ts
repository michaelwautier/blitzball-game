import { describe, expect, it } from 'vitest'
import { createMatch, stepMatch, switchControlled } from './state'
import { giveBallTo } from './possession'
import type { MatchState, Player } from './types'
import { BESAID_AUROCHS, LUCA_GOERS } from '../../data/teams'
import { ENGAGE_RADIUS } from '../encounter/encounter'
import { POOL_RADIUS } from '../pitch'

const TICK = 1 / 60
const newMatch = (seed = 'control') => createMatch(BESAID_AUROCHS, LUCA_GOERS, seed)

function find(state: MatchState, id: string): Player {
  const player = state.players.find((p) => p.id === id)
  if (!player) throw new Error(`no player ${id}`)
  return player
}

/** Hold possession with the opponent and keep it there, so control cannot follow it. */
function opponentHolds(state: MatchState, carrierId = 'away:bickson'): Player {
  const carrier = find(state, carrierId)
  carrier.x = 0
  carrier.y = 0
  giveBallTo(state, carrier)
  state.phase = { kind: 'play' }
  return carrier
}

describe('who the user is steering', () => {
  it('follows possession onto the carrier', () => {
    const state = newMatch()
    const wakka = find(state, 'home:wakka')
    giveBallTo(state, wakka)

    stepMatch(state, TICK)
    expect(state.controlled).toBe(wakka.id)
  })

  it('stays put while the opponent keeps the ball', () => {
    const state = newMatch('sticky')
    const carrier = opponentHolds(state)
    const held = find(state, 'home:datto')
    state.controlled = held.id

    // Drive the ball right across the pool; control must not chase it.
    for (let i = 0; i < 300; i++) {
      carrier.x = -40 + (i / 300) * 80
      stepMatch(state, TICK)
      // Possession is pinned to the opponent for the whole run.
      giveBallTo(state, carrier)
      expect(state.controlled).toBe(held.id)
    }
  })

  it('never leaves the user steering a keeper', () => {
    const state = newMatch('keeper')
    const keeper = find(state, 'home:keepa')
    giveBallTo(state, keeper)

    stepMatch(state, TICK)
    expect(state.controlled).not.toBe(keeper.id)
    expect(find(state, state.controlled).slot).not.toBe('GK')
  })

  it('recovers if the held player somehow becomes invalid', () => {
    const state = newMatch('invalid')
    opponentHolds(state)
    state.controlled = 'nobody'

    stepMatch(state, TICK)
    const controlled = find(state, state.controlled)
    expect(controlled.team).toBe('home')
    expect(controlled.slot).not.toBe('GK')
  })
})

describe('switching player', () => {
  it('takes whoever is closest to the player on the ball', () => {
    const state = newMatch('switch')
    const carrier = opponentHolds(state)

    const near = find(state, 'home:letty')
    near.x = 4
    near.y = 0
    const far = find(state, 'home:datto')
    far.x = -40
    far.y = 20
    state.controlled = far.id

    expect(switchControlled(state)).toBe(true)
    expect(state.controlled).toBe(near.id)
    expect(carrier.team).toBe('away')
  })

  it('reports that it did nothing when already on the closest', () => {
    const state = newMatch('already')
    opponentHolds(state)

    const near = find(state, 'home:letty')
    near.x = 4
    near.y = 0
    for (const other of state.players.filter((p) => p.team === 'home' && p.id !== near.id)) {
      other.x = -45
      other.y = 25
    }
    state.controlled = near.id

    expect(switchControlled(state)).toBe(false)
    expect(state.controlled).toBe(near.id)
  })

  it('refuses when the ball is already ours', () => {
    const state = newMatch('ours')
    const wakka = find(state, 'home:wakka')
    giveBallTo(state, wakka)
    stepMatch(state, TICK)

    expect(switchControlled(state)).toBe(false)
    expect(state.controlled).toBe(wakka.id)
  })

  it('chases a loose ball when nobody has it', () => {
    const state = newMatch('loose')
    state.ball.carrier = null
    state.ball.x = 20
    state.ball.y = 10

    const near = find(state, 'home:datto')
    near.x = 22
    near.y = 10
    for (const other of state.players.filter((p) => p.team === 'home' && p.id !== near.id)) {
      other.x = -45
      other.y = -25
    }
    state.controlled = 'home:tidus'

    expect(switchControlled(state)).toBe(true)
    expect(state.controlled).toBe(near.id)
  })

  it('never hands over the keeper, however close they are', () => {
    const state = newMatch('not-keeper')
    const carrier = opponentHolds(state)
    const keeper = find(state, 'home:keepa')
    keeper.x = carrier.x + 1
    keeper.y = carrier.y

    switchControlled(state)
    expect(state.controlled).not.toBe(keeper.id)
  })
})

/**
 * The one moment the game should choose for you.
 *
 * Control is otherwise sticky on purpose — being reassigned every tick made
 * defending feel like something happening to you. A throw by the opposition is
 * the exception: play stops dead while the ball travels, the contest has
 * plainly moved to the other end of it, and staying behind on the player who
 * let go of it means arriving nowhere.
 */
describe('when the opposition throw', () => {
  /** Put an opposition throw in the air, aimed at a fixed point. */
  function theyThrow(state: MatchState, target: { x: number; y: number }): void {
    state.phase = {
      kind: 'flight',
      flight: {
        kind: 'pass',
        fromTeam: 'away',
        passerId: 'away:bickson',
        targetId: null,
        target,
        power: 20,
        travelled: 0,
        technique: null,
        blockersIgnored: 0,
      },
    }
  }

  it('hands over whoever can meet the ball', () => {
    const state = newMatch('meet-it')
    const near = find(state, 'home:jassu')
    near.x = 40
    near.y = 30
    for (const other of state.players.filter((p) => p.team === 'home' && p.id !== near.id)) {
      other.x = -80
      other.y = -30
    }
    state.controlled = 'home:tidus'

    theyThrow(state, { x: 42, y: 32 })
    stepMatch(state, TICK)

    expect(state.controlled).toBe(near.id)
  })

  it('leaves your own throw alone', () => {
    // Being handed a different player halfway through your own pass would take
    // the ball off you mid-decision.
    const state = newMatch('ours')
    state.controlled = 'home:tidus'
    theyThrow(state, { x: 42, y: 32 })
    if (state.phase.kind !== 'flight') throw new Error('expected a flight')
    state.phase.flight.fromTeam = 'home'

    const jassu = find(state, 'home:jassu')
    jassu.x = 42
    jassu.y = 32

    stepMatch(state, TICK)
    expect(state.controlled).toBe('home:tidus')
  })

  it('follows a fumbled throw on to whoever is gathering it', () => {
    // A throw that arrives spent starts a second leg towards the player
    // collecting it. That is where the ball is going, so that is where control
    // goes — it is about to be ours.
    const state = newMatch('fumble')
    const gatherer = find(state, 'home:datto')
    gatherer.x = -30
    gatherer.y = 20
    for (const other of state.players.filter((p) => p.team === 'home' && p.id !== gatherer.id)) {
      other.x = 70
      other.y = -20
    }
    state.controlled = 'home:tidus'

    theyThrow(state, { x: gatherer.x, y: gatherer.y })
    if (state.phase.kind !== 'flight') throw new Error('expected a flight')
    state.phase.flight.kind = 'spilled'
    state.phase.flight.targetId = gatherer.id

    stepMatch(state, TICK)
    expect(state.controlled).toBe(gatherer.id)
  })

  it('never hands over the keeper to meet a shot', () => {
    const state = newMatch('not-the-keeper')
    const keeper = find(state, 'home:keepa')
    state.controlled = 'home:tidus'
    for (const other of state.players.filter((p) => p.team === 'home' && p.slot !== 'GK')) {
      other.x = 90
      other.y = 40
    }

    theyThrow(state, { x: keeper.x, y: keeper.y })
    stepMatch(state, TICK)

    expect(state.controlled).not.toBe(keeper.id)
  })
})

/**
 * Being asked to defend an encounter you are nowhere near.
 *
 * Control is sticky, so the defender who closed the carrier down is very often
 * not the one you were swimming — and the camera follows whoever you are
 * steering. The menu would ask how your defence is challenging while showing you
 * a player at the other end of the pool.
 */
describe('when an encounter opens against us', () => {
  it('hands over one of the defenders actually in it', () => {
    const state = newMatch('into-the-encounter')
    const carrier = find(state, 'away:bickson')
    carrier.x = 0
    carrier.y = 0
    giveBallTo(state, carrier)
    state.phase = { kind: 'play' }
    state.engageCooldown = 0

    // Letty is on them; the player being steered is miles away.
    const letty = find(state, 'home:letty')
    letty.x = ENGAGE_RADIUS - 1
    letty.y = 0
    const stranded = find(state, 'home:datto')
    stranded.x = -POOL_RADIUS * 0.8
    stranded.y = POOL_RADIUS * 0.5
    state.controlled = stranded.id

    stepMatch(state, TICK)

    expect(state.phase.kind).toBe('encounter')
    expect(state.controlled).toBe(letty.id)
  })

  it('leaves control alone when the encounter is our own carrier being caught', () => {
    // Attacking, the carrier is already the one being steered, and the defenders
    // in the encounter are theirs. Nothing to move to.
    const state = newMatch('our-own')
    const carrier = find(state, 'home:wakka')
    carrier.x = 0
    carrier.y = 0
    giveBallTo(state, carrier)
    state.phase = { kind: 'play' }
    state.engageCooldown = 0

    const doram = find(state, 'away:doram')
    doram.x = ENGAGE_RADIUS - 1
    doram.y = 0

    stepMatch(state, TICK)
    expect(state.controlled).toBe(carrier.id)
  })
})
