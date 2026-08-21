import { describe, expect, it } from 'vitest'
import { snapshot, soundsBetween, type AudioSnapshot } from './events'
import { createMatch, stepMatch } from '../core/match/state'
import { giveBallTo } from '../core/match/possession'
import { startPass, startShot } from '../core/match/flight'
import { BESAID_AUROCHS, LUCA_GOERS } from '../../src/data/teams'
import type { MatchState, Player } from '../core/match/types'

const newMatch = (seed = 'sound') => createMatch(BESAID_AUROCHS, LUCA_GOERS, seed)

function find(state: MatchState, id: string): Player {
  const player = state.players.find((p) => p.id === id)
  if (!player) throw new Error(`no player ${id}`)
  return player
}

/** A snapshot with everything quiet, overridden as each test needs. */
const quiet = (over: Partial<AudioSnapshot> = {}): AudioSnapshot => ({
  phase: 'play',
  flight: null,
  carrier: 'home:wakka',
  carrierTeam: 'home',
  keeperHasIt: false,
  goals: 0,
  half: 1,
  ...over,
})

/**
 * The match is never told it is being listened to — the sounds are read off the
 * phase machine from outside, the same way the renderer reads positions. So the
 * reading has to be right about what happened, and quiet about what did not.
 */
describe('hearing what happened', () => {
  it('is silent when nothing has changed', () => {
    expect(soundsBetween(quiet(), quiet())).toEqual([])
  })

  it('tells a pass from a shot by what was thrown', () => {
    expect(soundsBetween(quiet(), quiet({ phase: 'flight', flight: 'pass' }))).toEqual(['pass'])
    expect(soundsBetween(quiet(), quiet({ phase: 'flight', flight: 'shot' }))).toEqual(['shot'])
  })

  it('does not throw twice for one throw still in the air', () => {
    const flying = quiet({ phase: 'flight', flight: 'shot' })
    expect(soundsBetween(flying, flying)).toEqual([])
  })

  it('says nothing about a fumble rolling on to whoever gathers it', () => {
    // The second leg of a spilled throw is not a new throw; the first already
    // made its noise.
    const before = quiet({ phase: 'flight', flight: 'pass' })
    expect(soundsBetween(before, quiet({ phase: 'flight', flight: 'spilled' }))).toEqual([])
  })

  it('hears a goal', () => {
    const before = quiet({ phase: 'flight', flight: 'shot' })
    const after = quiet({ phase: 'celebration', goals: 1, carrier: null, carrierTeam: null })
    expect(soundsBetween(before, after)).toContain('goal')
  })

  it('hears the keeper claim one instead, when it was not a goal', () => {
    const before = quiet({ phase: 'flight', flight: 'shot' })
    const after = quiet({ carrier: 'away:raudy', carrierTeam: 'away', keeperHasIt: true })
    expect(soundsBetween(before, after)).toEqual(['catch'])
  })

  it('does not call a goal a catch as well', () => {
    // A shot either beats the keeper or does not. Both firing would be the two
    // opposite ends of the same throw sounding at once.
    const before = quiet({ phase: 'flight', flight: 'shot' })
    const after = quiet({ phase: 'celebration', goals: 1, keeperHasIt: true })
    expect(soundsBetween(before, after)).toEqual(['goal'])
  })

  it('hears a tackle when the ball changes hands in a challenge', () => {
    const before = quiet({ phase: 'challenge' })
    const after = quiet({ carrier: 'away:doram', carrierTeam: 'away' })
    expect(soundsBetween(before, after)).toContain('tackle')
  })

  it('hears a breakthrough when it does not', () => {
    const before = quiet({ phase: 'challenge' })
    expect(soundsBetween(before, quiet())).toEqual(['breakthrough'])
  })

  it('does not call a lost ball a breakthrough', () => {
    const before = quiet({ phase: 'challenge' })
    const after = quiet({ carrier: 'away:doram', carrierTeam: 'away' })
    expect(soundsBetween(before, after)).not.toContain('breakthrough')
  })

  it('does not call an interception a tackle', () => {
    // Possession changing during open play is a fumble or a loose ball, and the
    // throw that caused it has already been heard.
    const before = quiet()
    const after = quiet({ carrier: 'away:doram', carrierTeam: 'away' })
    expect(soundsBetween(before, after)).toEqual([])
  })

  it('marks an encounter opening, once', () => {
    const open = quiet({ phase: 'encounter' })
    expect(soundsBetween(quiet(), open)).toEqual(['encounter'])
    expect(soundsBetween(open, open)).toEqual([])
  })

  it('blows the whistle at each end of the match, once each', () => {
    const half = quiet({ phase: 'halfTime' })
    expect(soundsBetween(quiet(), half)).toEqual(['whistle'])
    expect(soundsBetween(half, half)).toEqual([])
    expect(soundsBetween(quiet(), quiet({ phase: 'fullTime' }))).toEqual(['whistle'])
  })
})

describe('reading a real match', () => {
  it('hears a throw the engine actually launched', () => {
    const state = newMatch()
    const passer = find(state, 'home:wakka')
    giveBallTo(state, passer)
    const before = snapshot(state)

    state.ball.carrier = null
    state.phase = { kind: 'flight', flight: startPass(passer, find(state, 'home:tidus'), 20) }

    expect(soundsBetween(before, snapshot(state))).toEqual(['pass'])
  })

  it('hears a shot the engine actually launched', () => {
    const state = newMatch()
    const shooter = find(state, 'home:wakka')
    giveBallTo(state, shooter)
    const before = snapshot(state)

    state.ball.carrier = null
    state.phase = { kind: 'flight', flight: startShot(state, shooter, 20) }

    expect(soundsBetween(before, snapshot(state))).toEqual(['shot'])
  })

  it('never says two contradictory things about one frame', () => {
    // Played out at length rather than staged: whatever the engine does, a frame
    // should not report both a goal and a catch, or a tackle and a breakthrough.
    const state = newMatch('real')
    let before = snapshot(state)

    for (let i = 0; i < 40000 && state.phase.kind !== 'fullTime'; i++) {
      stepMatch(state, 1 / 60)
      const now = snapshot(state)
      const heard = soundsBetween(before, now)
      expect(heard.includes('goal') && heard.includes('catch')).toBe(false)
      expect(heard.includes('tackle') && heard.includes('breakthrough')).toBe(false)
      before = now
    }
  })
})
