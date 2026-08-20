import { describe, expect, it } from 'vitest'
import { createMatch, requestActionMenu, requestChallenge, stepMatch, submitDefence } from './state'
import { giveBallTo } from './possession'
import {
  ENGAGE_RADIUS,
  ENGAGED_COOLDOWN,
  RESUME_GRACE,
  chargeCommittedDefenders,
  openEncounter,
  resolveEncounter,
} from '../encounter/encounter'
import type { Encounter } from './types'
import type { MatchState, Player } from './types'
import { BESAID_AUROCHS, LUCA_GOERS } from '../../data/teams'

const TICK = 1 / 60

/**
 * Resolve a throw the way the engine does for an AI carrier, since the harness
 * cannot submit an action on the opponent's behalf.
 */
function submitEncounterActionAsAi(state: MatchState, encounter: Encounter): void {
  resolveEncounter(state, encounter, {
    kind: 'pass',
    targetId: 'away:abus',
    techniqueId: null,
  })
  chargeCommittedDefenders(state, encounter)
}

function find(state: MatchState, id: string): Player {
  const player = state.players.find((p) => p.id === id)
  if (!player) throw new Error(`no player ${id}`)
  return player
}

/**
 * The opponent on the ball, our chosen defender beside them, and a global grace
 * running — the situation that used to leave a defender with nothing to do.
 */
function glued(seed = 'challenge', defenderId = 'home:letty'): MatchState {
  const state = createMatch(BESAID_AUROCHS, LUCA_GOERS, seed)
  const carrier = find(state, 'away:bickson')
  carrier.x = 0
  carrier.y = 0
  giveBallTo(state, carrier)

  const defender = find(state, defenderId)
  defender.x = ENGAGE_RADIUS - 1
  defender.y = 0
  defender.recovery = 0
  defender.engageCooldown = 0
  state.controlled = defender.id

  // Everyone else well out of it, so only this defender is in play.
  for (const other of state.players.filter((p) => p.team === 'home' && p.id !== defender.id)) {
    other.x = -95
    other.y = 60
  }

  state.phase = { kind: 'play' }
  state.engageCooldown = RESUME_GRACE
  return state
}

describe('challenging the player on the ball', () => {
  it('opens an encounter even while the grace is running', () => {
    const state = glued()
    expect(state.engageCooldown).toBeGreaterThan(0)

    expect(requestChallenge(state)).toBe(true)
    expect(state.phase.kind).toBe('encounter')
  })

  it('produces the encounter waiting would have produced', () => {
    // The key changes *when* a defender may act, not what acting gets them: the
    // same carrier, challenged by the defender who asked for it.
    const state = glued('waited')
    requestChallenge(state)

    if (state.phase.kind !== 'encounter') throw new Error('expected an encounter')
    const { encounter } = state.phase
    expect(encounter.kind).toBe('contested')
    expect(encounter.carrierId).toBe('away:bickson')
    expect(encounter.defenders.map((d) => d.id)).toContain('home:letty')
    // Our defenders, so the defence is asked how it is coming in.
    expect(encounter.awaitingDefence).toBe(true)
  })

  it('names the defence, as an encounter that happens by itself does', () => {
    const state = glued('announce')
    requestChallenge(state)
    expect(state.announcement).toContain('Letty on defense!')
  })

  it('brings anyone else already on the carrier along', () => {
    const state = glued('crowd')
    const second = find(state, 'home:jassu')
    second.x = ENGAGE_RADIUS - 1
    second.y = 1
    second.recovery = 0
    second.engageCooldown = 0

    requestChallenge(state)
    if (state.phase.kind !== 'encounter') throw new Error('expected an encounter')
    expect(state.phase.encounter.defenders).toHaveLength(2)
  })
})

describe('when a challenge is refused', () => {
  it('refuses when our own side has the ball', () => {
    const state = glued('ours')
    giveBallTo(state, find(state, 'home:wakka'))
    expect(requestChallenge(state)).toBe(false)
  })

  it('refuses from too far away', () => {
    const state = glued('far')
    find(state, state.controlled).x = ENGAGE_RADIUS + 12
    expect(requestChallenge(state)).toBe(false)
    expect(state.phase.kind).toBe('play')
  })

  it('refuses from a defender who has just been beaten', () => {
    const state = glued('beaten')
    find(state, state.controlled).recovery = 1.5
    expect(requestChallenge(state)).toBe(false)
  })

  it('refuses a second challenge from the same defender straight away', () => {
    const state = glued('spam')
    expect(requestChallenge(state)).toBe(true)

    // Back to open play, still glued to them, key mashed again.
    state.phase = { kind: 'play' }
    find(state, state.controlled).engageCooldown = ENGAGED_COOLDOWN
    expect(requestChallenge(state)).toBe(false)
  })

  it('refuses while an encounter is already open', () => {
    const state = glued('already')
    requestChallenge(state)
    expect(requestChallenge(state)).toBe(false)
  })

  it('refuses when the ball is loose', () => {
    const state = glued('loose')
    state.ball.carrier = null
    expect(requestChallenge(state)).toBe(false)
  })
})

describe('the two halves of the same key', () => {
  it('stops and looks up when we have the ball, and challenges when we do not', () => {
    // On the ball: the carrier's own decision opens.
    const attacking = createMatch(BESAID_AUROCHS, LUCA_GOERS, 'both')
    const wakka = find(attacking, 'home:wakka')
    giveBallTo(attacking, wakka)
    attacking.phase = { kind: 'play' }
    stepMatch(attacking, TICK)
    expect(requestActionMenu(attacking) || requestChallenge(attacking)).toBe(true)

    // Off it: the challenge opens instead, and the carrier is theirs.
    const defending = glued('both-defending')
    expect(requestActionMenu(defending) || requestChallenge(defending)).toBe(true)
    if (defending.phase.kind !== 'encounter') throw new Error('expected an encounter')
    expect(defending.phase.encounter.carrierId).toBe('away:bickson')
  })
})

describe('a defender who committed', () => {
  it('cannot challenge again the moment the encounter ends', () => {
    const state = glued('committed')
    requestChallenge(state)
    submitDefence(state, null)
    for (let i = 0; i < 600 && state.phase.kind === 'encounter'; i++) stepMatch(state, TICK)
    expect(state.phase.kind, 'the encounter never resolved').not.toBe('encounter')

    // However it went — beaten, or simply thrown past — they are not free to
    // haul the next carrier into another decision on the same breath.
    const defender = find(state, 'home:letty')
    expect(defender.recovery + defender.engageCooldown).toBeGreaterThan(0)
  })

  it('is charged rather than frozen when the carrier simply throws', () => {
    // Being thrown past is not being beaten: they keep swimming.
    const state = glued('thrown')
    const carrier = find(state, 'away:bickson')
    const encounter = openEncounter(state, carrier, [find(state, 'home:letty')])
    state.phase = { kind: 'encounter', encounter }
    encounter.awaitingDefence = false

    submitEncounterActionAsAi(state, encounter)

    const defender = find(state, 'home:letty')
    expect(defender.engageCooldown).toBe(ENGAGED_COOLDOWN)
    expect(defender.recovery, 'was frozen, not merely charged').toBe(0)
  })

  it('runs the cooldown down as play goes on', () => {
    const state = glued('ticks')
    const defender = find(state, 'home:letty')
    defender.engageCooldown = ENGAGED_COOLDOWN

    for (let i = 0; i < 30; i++) stepMatch(state, TICK)
    expect(defender.engageCooldown).toBeLessThan(ENGAGED_COOLDOWN)
  })
})
