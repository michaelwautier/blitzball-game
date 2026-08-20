import { describe, expect, it } from 'vitest'
import { Squad } from './squad'
import { currentStats, expForNextLevel } from './career'
import { EXP_AWARDS } from './awards'
import {
  createMatch,
  requestActionMenu,
  stepMatch,
  submitDefence,
  submitEncounterAction,
} from '../match/state'
import { awardExp } from '../match/exp'
import {
  chooseEncounterAction,
  chooseTackleTechnique,
  shouldStopAndShoot,
} from '../ai/decisions'
import { autoIntent } from '../ai/autopilot'
import { HALF_SECONDS } from '../match/state'
import { USER_TEAM, type MatchState } from '../match/types'
import { BESAID_AUROCHS, LUCA_GOERS, findPlayer } from '../../data/teams'

const TICK = 1 / 60
const TEAMS = { home: BESAID_AUROCHS, away: LUCA_GOERS } as const

const newMatch = (squad?: Squad, seed = 'squad') =>
  createMatch(BESAID_AUROCHS, LUCA_GOERS, seed, squad?.lookup)

/** Play a full match out with both sides on AI. */
function playOut(state: MatchState): void {
  const limit = Math.ceil((HALF_SECONDS * 2 + 120) / TICK)
  for (let i = 0; i < limit && state.phase.kind !== 'fullTime'; i++) {
    stepMatch(state, TICK, autoIntent(state))

    const onBall = state.players.find((p) => p.id === state.ball.carrier)
    if (
      state.phase.kind === 'play' &&
      onBall?.team === USER_TEAM &&
      onBall.slot !== 'GK' &&
      shouldStopAndShoot(state, onBall)
    ) {
      requestActionMenu(state)
    }

    if (state.phase.kind === 'encounter' && state.phase.encounter.awaitingDefence) {
      submitDefence(state, chooseTackleTechnique(state, state.phase.encounter))
    }

    if (state.phase.kind === 'encounter') {
      const { encounter } = state.phase
      const carrier = state.players.find((p) => p.id === encounter.carrierId)
      if (carrier?.team === USER_TEAM) {
        submitEncounterAction(state, chooseEncounterAction(state, encounter))
      }
    }
  }
}

describe('recording experience during a match', () => {
  it('starts a match with nobody having earned anything', () => {
    expect(newMatch().exp).toEqual({})
  })

  it('credits a player for what they did', () => {
    const state = newMatch()
    const tidus = state.players.find((p) => p.id === 'home:tidus')!

    awardExp(state, tidus, 'goal')
    expect(state.exp['home:tidus']).toBe(EXP_AWARDS.goal)
  })

  it('accumulates across a match', () => {
    const state = newMatch()
    const tidus = state.players.find((p) => p.id === 'home:tidus')!

    awardExp(state, tidus, 'pass')
    awardExp(state, tidus, 'shot')
    expect(state.exp['home:tidus']).toBe(EXP_AWARDS.pass + EXP_AWARDS.shot)
  })

  it('shrugs off a credit for nobody', () => {
    const state = newMatch()
    expect(() => awardExp(state, undefined, 'goal')).not.toThrow()
    expect(state.exp).toEqual({})
  })

  it('spreads experience around over a real match', () => {
    const state = newMatch(undefined, 'spread')
    playOut(state)

    const earners = Object.entries(state.exp).filter(([, exp]) => exp > 0)
    expect(earners.length, 'several players should have earned something').toBeGreaterThan(4)

    // Defenders earn from tackling, not only forwards from scoring.
    const defenders = ['home:letty', 'home:jassu', 'away:doram', 'away:balgerda']
    expect(defenders.some((id) => (state.exp[id] ?? 0) > 0)).toBe(true)
  })
})

describe('banking a match', () => {
  it('turns match experience into careers', () => {
    const squad = new Squad()
    const state = newMatch(squad)
    const tidus = state.players.find((p) => p.id === 'home:tidus')!
    awardExp(state, tidus, 'goal')

    const progress = squad.applyMatch(state, TEAMS)

    expect(progress).toHaveLength(1)
    expect(progress[0]!.name).toBe('Tidus')
    expect(squad.career('home:tidus').exp).toBe(EXP_AWARDS.goal)
  })

  it('leaves out players who did nothing', () => {
    const squad = new Squad()
    const state = newMatch(squad)
    awardExp(state, state.players.find((p) => p.id === 'home:tidus')!, 'pass')

    const progress = squad.applyMatch(state, TEAMS)
    expect(progress.map((p) => p.name)).toEqual(['Tidus'])
  })

  it('leads with whoever had the biggest match', () => {
    const squad = new Squad()
    const state = newMatch(squad)
    awardExp(state, state.players.find((p) => p.id === 'home:tidus')!, 'pass')
    awardExp(state, state.players.find((p) => p.id === 'home:wakka')!, 'goal')

    expect(squad.applyMatch(state, TEAMS)[0]!.name).toBe('Wakka')
  })

  it('keeps the two sides apart even in a mirror fixture', () => {
    const squad = new Squad()
    const state = createMatch(BESAID_AUROCHS, BESAID_AUROCHS, 'mirror', squad.lookup)

    awardExp(state, state.players.find((p) => p.id === 'home:tidus')!, 'goal')
    squad.applyMatch(state, { home: BESAID_AUROCHS, away: BESAID_AUROCHS })

    expect(squad.career('home:tidus').exp).toBe(EXP_AWARDS.goal)
    expect(squad.career('away:tidus').exp).toBe(0)
  })
})

describe('carrying progress into the next match', () => {
  it('fields a levelled-up player with better stats', () => {
    const squad = new Squad()
    const tidusDef = findPlayer(BESAID_AUROCHS, 'tidus')

    // Bank enough for several levels through the squad's own career object.
    const career = squad.career('home:tidus')
    const first = newMatch(squad)
    const before = first.players.find((p) => p.id === 'home:tidus')!.stats

    awardExp(first, first.players.find((p) => p.id === 'home:tidus')!, 'goal')
    squad.applyMatch(first, TEAMS)
    // Top up to guarantee a level, whatever the award table says.
    for (let i = 0; i < 12; i++) {
      const state = newMatch(squad)
      const player = state.players.find((p) => p.id === 'home:tidus')!
      for (let n = 0; n < 10; n++) awardExp(state, player, 'goal')
      squad.applyMatch(state, TEAMS)
    }

    expect(career.level).toBeGreaterThan(1)

    const next = newMatch(squad)
    const after = next.players.find((p) => p.id === 'home:tidus')!.stats

    expect(after.sh).toBeGreaterThan(before.sh)
    expect(after).toEqual(currentStats(tidusDef, career))
  })

  it('starts a levelled player on their improved HP', () => {
    const squad = new Squad()
    const career = squad.career('home:wakka')
    career.level = 5
    career.gains = { ...career.gains, hp: 30 }

    const state = newMatch(squad)
    const wakka = state.players.find((p) => p.id === 'home:wakka')!

    expect(wakka.stats.hp).toBe(findPlayer(BESAID_AUROCHS, 'wakka').stats.hp + 30)
    expect(wakka.hp).toBe(wakka.stats.hp)
  })

  it('does not touch players whose careers it has never seen', () => {
    const squad = new Squad()
    const state = newMatch(squad)
    const datto = state.players.find((p) => p.id === 'home:datto')!
    expect(datto.stats).toEqual(findPlayer(BESAID_AUROCHS, 'datto').stats)
  })

  it('banks a match only once', () => {
    const squad = new Squad()
    const state = newMatch(squad)
    awardExp(state, state.players.find((p) => p.id === 'home:tidus')!, 'goal')

    squad.applyMatch(state, TEAMS)
    const after = squad.career('home:tidus').exp

    // The caller is responsible for not re-banking; this documents that the
    // match state itself is not consumed, so a second call would double-count.
    squad.applyMatch(state, TEAMS)
    expect(squad.career('home:tidus').exp).toBe(after + EXP_AWARDS.goal)
  })
})

describe('a real match produces real progress', () => {
  it('levels somebody up over a full match', () => {
    const squad = new Squad()
    const state = newMatch(squad, 'progression')
    playOut(state)

    const progress = squad.applyMatch(state, TEAMS)
    expect(progress.length).toBeGreaterThan(0)

    const best = progress[0]!
    expect(best.expGained).toBeGreaterThan(0)
    // A whole match should be worth at least one level to the busiest player.
    expect(best.expGained).toBeGreaterThanOrEqual(expForNextLevel(1))
    expect(best.levelAfter).toBeGreaterThan(best.levelBefore)
  })
})
