import { POOL_RADIUS, clampToPool } from '../pitch'
import { attackDirection } from '../match/formation'
import { PLAYER_RADIUS, REFERENCE_POOL_RADIUS, recordPrevious } from '../match/movement'
import { distanceBetween, opponentOf, playerById } from '../match/queries'
import { giveBallTo } from '../match/possession'
import { startPass, startShot } from '../match/flight'
import type {
  Encounter,
  EncounterAction,
  EncounterDefender,
  EncounterKind,
  EncounterResult,
  MatchState,
  Player,
} from '../match/types'
import { USER_TEAM } from '../match/types'
import { ACTION_HP_COST, rollBounds, rollStat } from './formulas'
import { findTechnique, techniquesOf, type Technique } from '../../data/techniques'
import { applyStatus } from '../match/status'
import { canAfford, effectiveStat, spendHp } from '../match/stats'
import { awardExp } from '../match/exp'

/**
 * How close a defender must be to drag the carrier into an encounter.
 *
 * Must exceed the separation floor of `PLAYER_RADIUS * 2`, or bodies could never
 * get close enough to trigger one, and must stay above `MARKING_DISTANCE` so a
 * defender at its marking station is genuinely on the carrier.
 *
 * Grows with the square root of the pool rather than not at all. Bodies staying
 * the same size is what turns a bigger pool into more room, but leaving reach
 * fixed as well meant defenders covered so much less of it that scoring rose by
 * half. The square root splits the difference: still markedly more space, without
 * the defence being spread to nothing.
 */
export const ENGAGE_RADIUS =
  PLAYER_RADIUS * 2.3 * (POOL_RADIUS / REFERENCE_POOL_RADIUS)

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
 * Their attack stats are recorded as they stand; the tackles themselves are
 * rolled when they are made. The menu therefore shows a range rather than a
 * promise, which is the honest presentation of a gamble.
 */
export function openEncounter(
  state: MatchState,
  carrier: Player,
  defenders: Player[],
): Encounter {
  return {
    carrierId: carrier.id,
    defenders: defenders.map((d) => ({
      id: d.id,
      attack: effectiveStat(d, 'at'),
      block: effectiveStat(d, 'bl'),
    })),
    kind: 'contested',
    endurance: state.endurance,
    thinkTimer: carrier.team === USER_TEAM ? 0 : AI_THINK_SECONDS,
  }
}

/**
 * The carrier stops and looks up of their own accord.
 *
 * No defender has committed, so there is nothing to break past: the choice is
 * simply who to find, or whether to take it on themselves.
 */
export function openOnTheBall(state: MatchState, carrier: Player): Encounter {
  return {
    kind: 'onTheBall',
    carrierId: carrier.id,
    defenders: [],
    endurance: state.endurance,
    thinkTimer: carrier.team === USER_TEAM ? 0 : AI_THINK_SECONDS,
  }
}

/**
 * The least and most total tackle a carrier could face from these defenders.
 *
 * Mirrors the bounds of `rollStat`, and is the single source of truth for both
 * the menu's odds and the AI's judgement — so what a player is shown and what
 * the opponent reasons about cannot drift apart.
 */
export function tackleRange(defenders: readonly EncounterDefender[]): {
  min: number
  max: number
} {
  return totalRange(defenders.map((d) => d.attack))
}

/** The same, for the blocking a pass or shot has to survive. */
export function blockRange(defenders: readonly EncounterDefender[]): {
  min: number
  max: number
} {
  return totalRange(defenders.map((d) => d.block))
}

function totalRange(stats: readonly number[]): { min: number; max: number } {
  let min = 0
  let max = 0
  for (const stat of stats) {
    const bounds = rollBounds(stat)
    min += bounds.min
    max += bounds.max
  }
  return { min, max }
}

/** Which actions this kind of decision permits. */
export function allowedActions(kind: EncounterKind): EncounterAction['kind'][] {
  switch (kind) {
    case 'contested':
      return ['breakthrough', 'pass', 'shoot']
    case 'onTheBall':
      return ['pass', 'shoot']
    case 'distribution':
      return ['pass']
  }
}

/**
 * A keeper restarting play after claiming the ball.
 *
 * Keepers hold their line: they never dribble out or shoot, so the only decision
 * is who to find. Modelled as an encounter with no defenders so it reuses the
 * same menu, resolution and technique handling as any other pass.
 */
export function openDistribution(state: MatchState, keeper: Player): Encounter {
  return {
    kind: 'distribution',
    carrierId: keeper.id,
    defenders: [],
    endurance: state.endurance,
    thinkTimer: keeper.team === USER_TEAM ? 0 : AI_THINK_SECONDS,
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

  // Anything the decision does not permit is refused outright rather than
  // half-applied, so no stray input can dribble a goalkeeper up the pool or
  // barge past defenders who were never there.
  if (!allowedActions(encounter.kind).includes(action.kind)) {
    return {
      action: action.kind,
      success: false,
      summary:
        encounter.kind === 'distribution'
          ? `${carrier.def.name} must find a teammate`
          : `${carrier.def.name} cannot do that here`,
    }
  }

  switch (action.kind) {
    case 'breakthrough':
      return resolveBreakthrough(state, encounter, carrier)
    case 'pass':
      return resolvePass(state, encounter, carrier, action.targetId, action.techniqueId)
    case 'shoot':
      return resolveShoot(state, encounter, carrier, action.techniqueId)
  }
}

/**
 * Each defender in turn puts in a tackle, and endurance has to survive them all.
 *
 * Tackles are resolved one at a time rather than as a single pooled total, so
 * the carrier is up against a sequence of individual challenges: the first
 * defender may take most of the endurance and leave the second an easy job, or
 * may barely make contact. Whoever takes it to zero is the one who comes away
 * with the ball, which is why the closest defender tackles first.
 *
 * The drain persists for the whole possession, so repeated breakthroughs get
 * progressively more dangerous — that pressure is what makes passing and
 * shooting real decisions rather than fallbacks.
 */
function resolveBreakthrough(
  state: MatchState,
  encounter: Encounter,
  carrier: Player,
): EncounterResult {
  spendHp(carrier, ACTION_HP_COST.breakthrough)

  let endurance = encounter.endurance
  const rolls: number[] = []
  const beaten: Player[] = []
  let tackler: Player | undefined

  for (const engaged of encounter.defenders) {
    const defender = playerById(state, engaged.id)
    if (!defender) continue

    const tackle = rollStat(effectiveStat(defender, 'at'), state.rng)
    endurance -= tackle
    rolls.push(tackle)
    beaten.push(defender)

    if (endurance <= 0) {
      // This challenge is the one that dislodged the ball; the defenders behind
      // it never needed to commit.
      tackler = defender
      break
    }
  }

  state.endurance = Math.max(0, endurance)
  // Everyone who put a tackle in has committed past the carrier by the end of
  // it, whether or not they came away with the ball.
  pushPastCarrier(state, beaten, carrier)

  const sums = `EN ${encounter.endurance} − ${rolls.join(' − ')} = ${endurance}`

  if (!tackler) {
    state.engageCooldown = BREAKTHROUGH_GRACE
    awardExp(state, carrier, 'breakthrough')
    return {
      action: 'breakthrough',
      success: true,
      summary: `${sums} · ${carrier.def.name} breaks through!`,
    }
  }

  awardExp(state, tackler, 'tackle')
  const technique = useTackleTechnique(tackler, carrier)
  giveBallTo(state, tackler)

  return {
    action: 'breakthrough',
    success: false,
    summary: `${sums} · tackled by ${tackler.def.name}${technique ? ` · ${technique.name}!` : ''}`,
  }
}

/**
 * Put the defenders who tackled behind the carrier.
 *
 * A challenge carries a defender past the player they went through, so leaving
 * them in front would mean a successful breakthrough changed nothing
 * positionally and the same defenders re-engaged the moment the grace period
 * ended. `recordPrevious` matters here: these bodies are being moved rather than
 * swum, and without it the renderer interpolates across the jump.
 */
function pushPastCarrier(state: MatchState, defenders: Player[], carrier: Player): void {
  const forward = attackDirection(state.teams[carrier.team].defending)

  for (const defender of defenders) {
    const spot = clampToPool(
      { x: carrier.x - forward * (ENGAGE_RADIUS + 1), y: defender.y },
      PLAYER_RADIUS,
    )
    defender.x = spot.x
    defender.y = spot.y
    defender.vx = 0
    defender.vy = 0
    recordPrevious(defender)
  }
}

/**
 * Fire a defender's tackle technique on the player they just dispossessed.
 *
 * Tackle techniques belong to the defence and have no menu, so they trigger
 * automatically when the tackle lands and the defender can pay for it.
 */
function useTackleTechnique(tackler: Player, victim: Player): Technique | null {
  for (const technique of techniquesOf(tackler.def.techniques, 'tackle')) {
    if (!canAfford(tackler, technique.hpCost)) continue
    spendHp(tackler, technique.hpCost)
    if (technique.inflicts) applyStatus(victim, technique.inflicts)
    return technique
  }
  return null
}

/**
 * The defenders left of a pass or shot: their blocking, rolled, comes off it.
 *
 * Resolved defender by defender in order of proximity so, as with a tackle,
 * whoever takes it to zero is the one who ends up with the ball. This is why
 * stopping on the ball in space is worth so much — with nobody engaged there is
 * nothing to subtract, and the throw faces only the distance.
 */
function contestThrow(
  state: MatchState,
  encounter: Encounter,
  power: number,
): { power: number; rolls: number[]; taker: Player | undefined } {
  const rolls: number[] = []
  let remaining = power

  for (const engaged of encounter.defenders) {
    const defender = playerById(state, engaged.id)
    if (!defender) continue

    const block = rollStat(effectiveStat(defender, 'bl'), state.rng)
    remaining -= block
    rolls.push(block)

    if (remaining <= 0) return { power: remaining, rolls, taker: defender }
  }

  return { power: remaining, rolls, taker: undefined }
}

/** "PA 8 − 3 − 2 = 3", the arithmetic laid out as it happened. */
function describeThrow(label: string, from: number, rolls: number[], to: number): string {
  const steps = rolls.length > 0 ? ` − ${rolls.join(' − ')}` : ''
  return `${label} ${from}${steps} = ${Math.max(0, Math.round(to))}`
}

function resolvePass(
  state: MatchState,
  encounter: Encounter,
  carrier: Player,
  targetId: string,
  techniqueId: string | null,
): EncounterResult {
  const receiver = playerById(state, targetId)
  if (!receiver || receiver.team !== carrier.team) {
    return { action: 'pass', success: false, summary: 'No one to pass to' }
  }

  const technique = affordableTechnique(carrier, techniqueId, 'pass')
  spendHp(carrier, ACTION_HP_COST.pass + (technique?.hpCost ?? 0))

  const start = effectiveStat(carrier, 'pa') + (technique?.power ?? 0)
  const contest = contestThrow(state, encounter, start)
  const name = technique ? `${technique.name} · ` : ''
  const sums = describeThrow('PA', start, contest.rolls, contest.power)

  // A pass technique's condition lands on everyone who tried to cut it out.
  if (technique?.inflicts) {
    for (const engaged of encounter.defenders) {
      const defender = playerById(state, engaged.id)
      if (defender) applyStatus(defender, technique.inflicts)
    }
  }

  if (contest.taker) {
    awardExp(state, contest.taker, 'interception')
    giveBallTo(state, contest.taker)
    return {
      action: 'pass',
      success: false,
      summary: `${name}${sums} · ${contest.taker.def.name} intercepts!`,
    }
  }

  state.ball.carrier = null
  state.phase = { kind: 'flight', flight: startPass(carrier, receiver, contest.power, technique) }
  state.engageCooldown = RESUME_GRACE

  return {
    action: 'pass',
    success: true,
    summary: `${name}${sums} · ${carrier.def.name} → ${receiver.def.name}`,
  }
}

function resolveShoot(
  state: MatchState,
  encounter: Encounter,
  carrier: Player,
  techniqueId: string | null,
): EncounterResult {
  const technique = affordableTechnique(carrier, techniqueId, 'shoot')
  spendHp(carrier, ACTION_HP_COST.shoot + (technique?.hpCost ?? 0))

  const start = effectiveStat(carrier, 'sh') + (technique?.power ?? 0)
  // A technique that splits the defence waves that many of them through.
  const facing = {
    ...encounter,
    defenders: encounter.defenders.slice(technique?.ignoresBlockers ?? 0),
  }
  const contest = contestThrow(state, facing, start)
  const name = technique ? `${technique.name}! · ` : ''
  const sums = describeThrow('SH', start, contest.rolls, contest.power)

  if (contest.taker) {
    awardExp(state, contest.taker, 'interception')
    giveBallTo(state, contest.taker)
    return {
      action: 'shoot',
      success: false,
      summary: `${name}${sums} · blocked by ${contest.taker.def.name}`,
    }
  }

  state.ball.carrier = null
  state.phase = { kind: 'flight', flight: startShot(state, carrier, contest.power, technique) }
  state.engageCooldown = RESUME_GRACE

  return {
    action: 'shoot',
    success: true,
    summary: `${name}${sums} · ${carrier.def.name} shoots!`,
  }
}

/**
 * Resolve a requested technique, or fall back to the plain action.
 *
 * A player who cannot pay simply performs the ordinary version rather than the
 * action failing, so running low on HP degrades what you can do instead of
 * taking options away mid-decision.
 */
function affordableTechnique(
  player: Player,
  techniqueId: string | null,
  kind: 'pass' | 'shoot',
): Technique | null {
  if (!techniqueId) return null
  if (!player.def.techniques.includes(techniqueId)) return null

  const technique = findTechnique(techniqueId)
  if (technique.kind !== kind) return null
  if (!canAfford(player, ACTION_HP_COST[kind] + technique.hpCost)) return null

  return technique
}
