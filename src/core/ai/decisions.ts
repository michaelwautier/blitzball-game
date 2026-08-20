import { GOAL_HALF_HEIGHT, goalLineX } from '../pitch'
import { ACTION_HP_COST, CONTEST_RADIUS, SHOT_DECAY_PER_UNIT } from '../encounter/formulas'
import { tackleRange } from '../encounter/encounter'
import { techniquesOf } from '../../data/techniques'
import {
  distanceBetween,
  keeperFor,
  opponentOf,
  outfieldTeammates,
  playerById,
} from '../match/queries'
import { effectiveStat } from '../match/stats'
import type { Encounter, EncounterAction, MatchState, Player } from '../match/types'

/**
 * How an AI carrier decides what to do when it is caught.
 *
 * Deliberately heuristic rather than a search: it shoots when it is close enough
 * to be dangerous, breaks through when its endurance comfortably covers the
 * tackle it is facing, and otherwise looks for the teammate in the most useful
 * space. The point is behaviour that reads as intentional, not optimal play.
 */

/**
 * How favourably a shot must compare to the keeper's catching before the AI
 * takes it on. Below 1 because both sides roll upward, so a shot that looks
 * slightly short still wins often enough to be worth attempting.
 */
const SHOOT_CONFIDENCE = 0.95

/** Never shoot from beyond this, whatever the arithmetic says. */
const MAX_SHOOTING_RANGE = 34

/**
 * Inside this range, shoot regardless of the odds.
 *
 * Without it a side with no strong shooter passes around the six-yard box
 * forever rather than ever testing the keeper, which is both bad football and a
 * stalemate the other team cannot break.
 */
const POINT_BLANK_RANGE = 8

/** A cornered carrier will only chance a speculative shot from inside this range. */
const DESPERATION_RANGE = 20

/** Endurance must exceed the incoming tackle by this much to risk a barge. */
const BREAKTHROUGH_MARGIN = 4

export function chooseEncounterAction(
  state: MatchState,
  encounter: Encounter,
): EncounterAction {
  const carrier = playerById(state, encounter.carrierId)
  if (!carrier) return { kind: 'breakthrough' }

  if (encounter.kind === 'distribution') return chooseDistribution(state, carrier)

  const goalDistance = distanceToOpposingGoal(state, carrier)
  // Judged on the middle of the range rather than the best case, so the AI is
  // not repeatedly surprised by tackles landing at the top of their roll.
  const { min, max } = tackleRange(encounter.defenders)
  const expected = (min + max) / 2
  const canBreakThrough =
    encounter.kind === 'contested' && encounter.endurance - expected > BREAKTHROUGH_MARGIN

  if (isShotWorthTaking(state, carrier, goalDistance)) {
    return { kind: 'shoot', techniqueId: chooseTechnique(carrier, 'shoot') }
  }

  if (canBreakThrough) return { kind: 'breakthrough' }

  const receiver = bestPassTarget(state, carrier)
  if (receiver) {
    return { kind: 'pass', targetId: receiver.id, techniqueId: chooseTechnique(carrier, 'pass') }
  }

  // Cornered: no shot on, not enough endurance, nobody to find. A speculative
  // shot at least tests the keeper, where barging into a tackle we have already
  // calculated we lose just hands the ball over. Without this fallback a team
  // whose best shooter cannot clear the opposing keeper's catching never shoots
  // at all, at any range, for the entire match.
  if (goalDistance <= DESPERATION_RANGE || encounter.kind !== 'contested') {
    return { kind: 'shoot', techniqueId: chooseTechnique(carrier, 'shoot') }
  }

  return { kind: 'breakthrough' }
}

/**
 * Whether a shot from here is worth taking, judged on the shot's power once
 * distance has eaten into it against the keeper the AI actually faces. Comparing
 * to the real keeper means a weak shooter respects a good goalkeeper, and a
 * strong one backs itself from further out.
 */
export function isShotWorthTaking(
  state: MatchState,
  carrier: Player,
  goalDistance: number,
): boolean {
  if (goalDistance > MAX_SHOOTING_RANGE) return false
  if (goalDistance <= POINT_BLANK_RANGE) return true

  const power = effectiveStat(carrier, 'sh') - goalDistance * SHOT_DECAY_PER_UNIT
  const keeper = keeperFor(state, opponentOf(carrier.team))
  const catching = keeper ? effectiveStat(keeper, 'ca') : 0

  return power > catching * SHOOT_CONFIDENCE
}

export function distanceToOpposingGoal(state: MatchState, player: Player): number {
  const attacking = state.teams[opponentOf(player.team)].defending
  return distanceBetween(player, { x: goalLineX(attacking), y: 0 })
}

/** How much closer to goal a pass must get the ball to be worth making. */
const MIN_PASS_ADVANCE = 2

/** Score penalty for passing to a teammate who is already being marked. */
const COVERED_PENALTY = 8

/**
 * The most useful teammate to find.
 *
 * Marked players are penalised rather than excluded, and the pass must actually
 * advance the ball. Excluding marked players outright looks safer but deadlocks:
 * defenders mark the forwards by definition, so the only "free" teammates are
 * behind the ball, and a side ends up passing backwards for the entire match
 * without ever entering the opposition half.
 */
export function bestPassTarget(state: MatchState, carrier: Player): Player | undefined {
  const carrierGoalDistance = distanceToOpposingGoal(state, carrier)

  let best: Player | undefined
  let bestScore = -Infinity
  let bestAdvance = 0

  for (const mate of outfieldTeammates(state, carrier.team, carrier.id)) {
    const advance = carrierGoalDistance - distanceToOpposingGoal(state, mate)
    // Long passes decay and are easier to read, so mild preference for nearby.
    const reach = -distanceBetween(carrier, mate) * 0.25
    const score = advance + reach - (isCovered(state, mate) ? COVERED_PENALTY : 0)

    if (score > bestScore) {
      bestScore = score
      bestAdvance = advance
      best = mate
    }
  }

  return bestAdvance > MIN_PASS_ADVANCE ? best : undefined
}

/** Whether an opponent is close enough to this player to contest a pass to them. */
export function isCovered(state: MatchState, player: Player): boolean {
  return state.players.some(
    (p) =>
      p.team === opponentOf(player.team) &&
      p.slot !== 'GK' &&
      distanceBetween(p, player) <= CONTEST_RADIUS,
  )
}

/** Whether this player has a shooting angle worth taking, used by the UI hint. */
export function hasShootingAngle(state: MatchState, player: Player): boolean {
  const attacking = state.teams[opponentOf(player.team)].defending
  const goalX = goalLineX(attacking)
  // Behind the goal line or wildly wide of the posts is not a shot.
  const wide = Math.abs(player.y) > GOAL_HALF_HEIGHT * 3
  return Math.abs(goalX - player.x) > 1 && !wide
}

/**
 * Fraction of a player's maximum HP kept back rather than spent on techniques.
 *
 * Proportional rather than flat so it means the same thing to Datto on 160 HP as
 * to Wakka on 250. Without a meaningful reserve the AI leans on its best move
 * every time it acts and spends the closing stages exhausted.
 */
const TECHNIQUE_HP_RESERVE_FRACTION = 0.45

/**
 * The best technique this player can afford for an action, or null for the plain
 * version. Scored on power, with a premium on inflicting a condition or going
 * straight through blockers, since both are worth more than raw numbers.
 */
export function chooseTechnique(player: Player, kind: 'shoot' | 'pass'): string | null {
  let best: string | null = null
  let bestScore = 0

  for (const technique of techniquesOf(player.def.techniques, kind)) {
    const total = ACTION_HP_COST[kind] + technique.hpCost
    const reserve = player.stats.hp * TECHNIQUE_HP_RESERVE_FRACTION
    if (player.hp - total < reserve) continue

    const score = technique.power + (technique.inflicts ? 5 : 0) + technique.ignoresBlockers * 3
    if (score > bestScore) {
      bestScore = score
      best = technique.id
    }
  }

  return best
}

/**
 * Who a keeper restarts play to.
 *
 * Unlike an open-play pass this cannot decline to happen, so it never returns
 * empty: it prefers a teammate who is both unmarked and upfield, but will settle
 * for the nearest body rather than leave the keeper holding the ball forever.
 */
export function chooseDistribution(state: MatchState, keeper: Player): EncounterAction {
  const mates = outfieldTeammates(state, keeper.team, keeper.id)
  const keeperGoalDistance = distanceToOpposingGoal(state, keeper)

  let best: Player | undefined
  let bestScore = -Infinity

  for (const mate of mates) {
    const advance = keeperGoalDistance - distanceToOpposingGoal(state, mate)
    // Being unmarked dominates: a keeper's pass is the one place on the pitch
    // where losing the ball concedes immediately. Among safe options, get it as
    // far upfield as possible — a short ball to a defender still inside their
    // own third simply hands the pressure straight back.
    const score =
      advance - distanceBetween(keeper, mate) * 0.15 - (isCovered(state, mate) ? 30 : 0)

    if (score > bestScore) {
      bestScore = score
      best = mate
    }
  }

  const receiver = best ?? mates[0]
  return {
    kind: 'pass',
    targetId: receiver?.id ?? '',
    techniqueId: receiver ? chooseTechnique(keeper, 'pass') : null,
  }
}
