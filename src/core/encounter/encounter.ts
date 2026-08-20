import { PLAYER_RADIUS } from '../match/movement'
import { distanceBetween, opponentOf, playerById } from '../match/queries'
import { giveBallTo, releaseBall } from '../match/possession'
import { startPass, startShot } from '../match/flight'
import type {
  Encounter,
  EncounterAction,
  EncounterResult,
  MatchState,
  Player,
} from '../match/types'
import { USER_TEAM } from '../match/types'
import { rollStat } from './formulas'

/**
 * How close a defender must be to drag the carrier into an encounter.
 *
 * Must exceed the separation floor of `PLAYER_RADIUS * 2`, or bodies could never
 * get close enough to trigger one, and must stay under `MARKING_DISTANCE` so a
 * defender at its marking station is not already on top of the carrier.
 */
export const ENGAGE_RADIUS = PLAYER_RADIUS * 2.3

/** Seconds an AI carrier appears to deliberate, so its choice is readable. */
export const AI_THINK_SECONDS = 0.35

/** Seconds the outcome is shown before play resumes. */
export const RESULT_SECONDS = 1.1

/**
 * Seconds defenders are held off after a successful breakthrough.
 *
 * This, with `POSSESSION_GRACE`, is what sets the rhythm of a match. Short
 * values produce hundreds of encounters and a game that is nothing but menus;
 * these give a possession room to actually travel before it is challenged again.
 */
export const BREAKTHROUGH_GRACE = 2.5

/** Seconds before the next encounter after any other outcome. */
export const RESUME_GRACE = 1.5

/** Opponents currently close enough to engage this carrier. */
export function engagingDefenders(state: MatchState, carrier: Player): Player[] {
  return state.players
    .filter(
      (p) =>
        p.team === opponentOf(carrier.team) &&
        p.slot !== 'GK' &&
        distanceBetween(p, carrier) <= ENGAGE_RADIUS,
    )
    .sort((a, b) => distanceBetween(a, carrier) - distanceBetween(b, carrier))
}

/**
 * Open an encounter against these defenders.
 *
 * Each defender's AT is rolled once, here, and held for the duration. Rolling up
 * front rather than at resolution means the odds cannot shift based on which
 * action is chosen, and lets the menu honestly show what is being faced.
 */
export function openEncounter(
  state: MatchState,
  carrier: Player,
  defenders: Player[],
): Encounter {
  return {
    carrierId: carrier.id,
    defenders: defenders.map((d) => ({ id: d.id, attack: rollStat(d.def.stats.at, state.rng) })),
    endurance: state.endurance,
    thinkTimer: carrier.team === USER_TEAM ? 0 : AI_THINK_SECONDS,
  }
}

/**
 * Resolve the carrier's chosen action, mutating the match accordingly.
 *
 * Breakthrough settles here and play resumes. Pass and shoot hand off to a ball
 * flight, which can still be intercepted before it arrives — so choosing them is
 * a commitment, not a guaranteed escape.
 */
export function resolveEncounter(
  state: MatchState,
  encounter: Encounter,
  action: EncounterAction,
): EncounterResult {
  const carrier = playerById(state, encounter.carrierId)
  if (!carrier) {
    return { action: action.kind, success: false, summary: 'Possession lost' }
  }

  switch (action.kind) {
    case 'breakthrough':
      return resolveBreakthrough(state, encounter, carrier)
    case 'pass':
      return resolvePass(state, carrier, action.targetId)
    case 'shoot':
      return resolveShoot(state, carrier)
  }
}

/**
 * Endurance versus the defenders' combined tackle.
 *
 * The drain persists for the whole possession, so repeated breakthroughs get
 * progressively more dangerous — which is the pressure that makes passing and
 * shooting real decisions rather than fallbacks.
 */
function resolveBreakthrough(
  state: MatchState,
  encounter: Encounter,
  carrier: Player,
): EncounterResult {
  const attack = encounter.defenders.reduce((total, d) => total + d.attack, 0)
  const remaining = encounter.endurance - attack
  state.endurance = Math.max(0, remaining)

  if (remaining > 0) {
    state.engageCooldown = BREAKTHROUGH_GRACE
    return {
      action: 'breakthrough',
      success: true,
      summary: `EN ${encounter.endurance} − AT ${attack} = ${remaining} · ${carrier.def.name} breaks through!`,
    }
  }

  // Out of endurance: the strongest tackler takes it off them.
  const strongest = encounter.defenders.reduce((best, d) => (d.attack > best.attack ? d : best))
  const tackler = playerById(state, strongest.id)
  if (tackler) giveBallTo(state, tackler)
  else releaseBall(state)

  return {
    action: 'breakthrough',
    success: false,
    summary: `EN ${encounter.endurance} − AT ${attack} = ${remaining} · tackled by ${tackler?.def.name ?? 'the defence'}`,
  }
}

function resolvePass(
  state: MatchState,
  carrier: Player,
  targetId: string,
): EncounterResult {
  const receiver = playerById(state, targetId)
  if (!receiver || receiver.team !== carrier.team) {
    return { action: 'pass', success: false, summary: 'No one to pass to' }
  }

  const flight = startPass(state, carrier, receiver)
  state.ball.carrier = null
  state.phase = { kind: 'flight', flight }
  state.engageCooldown = RESUME_GRACE

  return {
    action: 'pass',
    success: true,
    summary: `PA ${flight.power.toFixed(0)} · ${carrier.def.name} → ${receiver.def.name}`,
  }
}

function resolveShoot(state: MatchState, carrier: Player): EncounterResult {
  const flight = startShot(state, carrier)
  state.ball.carrier = null
  state.phase = { kind: 'flight', flight }
  state.engageCooldown = RESUME_GRACE

  return {
    action: 'shoot',
    success: true,
    summary: `SH ${flight.power.toFixed(0)} · ${carrier.def.name} shoots!`,
  }
}
