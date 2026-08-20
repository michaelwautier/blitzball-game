import { GOAL_HALF_HEIGHT, POOL_RADIUS, goalLineX } from '../pitch'
import {
  ACTION_HP_COST,
  SHOT_DECAY_PER_UNIT,
  expectedCatch,
  rollBounds,
} from '../encounter/formulas'
import {
  ENGAGE_RADIUS,
  blockRange,
  defensiveTechniques,
  tackleRange,
} from '../encounter/encounter'
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
const MAX_SHOOTING_RANGE = POOL_RADIUS * 0.68

/**
 * Inside this range, shoot regardless of the odds.
 *
 * Without it a side with no strong shooter passes around the six-yard box
 * forever rather than ever testing the keeper, which is both bad football and a
 * stalemate the other team cannot break.
 */
const POINT_BLANK_RANGE = POOL_RADIUS * 0.16

/**
 * The closest an attacker will carry the ball before shooting.
 *
 * Without it an AI carrier swims into the goal and stops there: the AI only ever
 * chooses an action inside an encounter, so an unopposed attacker had no
 * mechanism to shoot at all and simply drove at the net until someone tackled
 * them. This is both where they stop advancing and where they let fly.
 *
 * Halved from a fifth of the pool, which was far enough out to make every shot
 * in the game a formality. A shot bleeds `SHOT_DECAY_PER_UNIT` for every unit it
 * travels, so pulling up out there spent five of a level-one shooter's eleven
 * points of SH on the journey alone; what reached the keeper, after a blocker
 * had taken their share, was almost exactly nothing. Sides were taking
 * twenty-five shots a match and scoring none, and the difference between a
 * fixture that produced goals and one that could not was a point or two of
 * blocking either side of that knife edge. Attackers now carry the ball in far
 * enough that the throw is still worth something when it arrives.
 */
export const SHOOTING_STANDOFF = POOL_RADIUS * 0.22

/** A cornered carrier will only chance a speculative shot from inside this range. */
const DESPERATION_RANGE = POOL_RADIUS * 0.4

/** Endurance must exceed the incoming tackle by this much to risk a barge. */
const BREAKTHROUGH_MARGIN = 4

export function chooseEncounterAction(
  state: MatchState,
  encounter: Encounter,
): EncounterAction {
  const carrier = playerById(state, encounter.carrierId)
  if (!carrier) return { kind: 'breakthrough', breakPast: 1 }

  if (encounter.kind === 'distribution') return chooseDistribution(state, carrier)

  const goalDistance = distanceToOpposingGoal(state, carrier)
  // Judged on the middle of the range rather than the best case, so the AI is
  // not repeatedly surprised by tackles landing at the top of their roll.
  const { min, max } = tackleRange(encounter.defenders)
  const expected = (min + max) / 2
  const canBreakThrough =
    encounter.kind === 'contested' && encounter.endurance - expected > BREAKTHROUGH_MARGIN

  /**
   * Clear a lane before throwing, if that is what the throw needs.
   *
   * Breaking is a step of its own now, so this returns a breakthrough to be made
   * *this* decision — the throw follows on the next one, against whoever is
   * left. Returning nothing means throw now.
   */
  const clearFirst = (stat: 'pa' | 'sh'): EncounterAction | undefined => {
    const count = chooseBreakPast(encounter, carrier, stat)
    return count > 0 ? { kind: 'breakthrough', breakPast: count } : undefined
  }

  if (isShotWorthTaking(state, carrier, goalDistance, encounter)) {
    return (
      clearFirst('sh') ?? {
        kind: 'shoot',
        techniqueId: chooseTechnique(carrier, 'shoot'),
      }
    )
  }

  if (canBreakThrough) {
    return { kind: 'breakthrough', breakPast: encounter.defenders.length }
  }

  const receiver = bestPassTarget(state, carrier)
  if (receiver) {
    return (
      clearFirst('pa') ?? {
        kind: 'pass',
        targetId: receiver.id,
        techniqueId: chooseTechnique(carrier, 'pass'),
      }
    )
  }

  // Cornered: no shot on, not enough endurance, nobody to find. A speculative
  // shot at least tests the keeper, where barging into a tackle we have already
  // calculated we lose just hands the ball over. Without this fallback a team
  // whose best shooter cannot clear the opposing keeper's catching never shoots
  // at all, at any range, for the entire match.
  if (goalDistance <= DESPERATION_RANGE || encounter.kind !== 'contested') {
    return (
      clearFirst('sh') ?? {
        kind: 'shoot',
        techniqueId: chooseTechnique(carrier, 'shoot'),
      }
    )
  }

  return { kind: 'breakthrough', breakPast: encounter.defenders.length }
}

/**
 * Whether a shot from here is worth taking.
 *
 * Weighed against everything it has to survive: the defenders on the carrier,
 * the trip to goal, and finally the keeper — each judged on the middle of its
 * range. Comparing against the real keeper means a weak shooter respects a good
 * goalkeeper, and a strong one backs itself from further out.
 */
export function isShotWorthTaking(
  state: MatchState,
  carrier: Player,
  goalDistance: number,
  encounter?: Encounter,
): boolean {
  if (goalDistance > MAX_SHOOTING_RANGE) return false

  const blocks = encounter ? blockRange(encounter.defenders) : { min: 0, max: 0 }
  const keeper = keeperFor(state, opponentOf(carrier.team))
  const catching = keeper ? expectedCatch(effectiveStat(keeper, 'ca')) : 0

  const power =
    effectiveStat(carrier, 'sh') -
    (blocks.min + blocks.max) / 2 -
    goalDistance * SHOT_DECAY_PER_UNIT

  // Close in, anything that survives the defence is worth a go.
  if (goalDistance <= POINT_BLANK_RANGE && power > 0) return true

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

/**
 * Whether an opponent is close enough to this player to be a problem.
 *
 * Uses the engagement radius, because that is now exactly what matters: a ball
 * played to someone already engaged is a ball played into a challenge.
 */
export function isCovered(state: MatchState, player: Player): boolean {
  return state.players.some(
    (p) =>
      p.team === opponentOf(player.team) &&
      p.slot !== 'GK' &&
      distanceBetween(p, player) <= ENGAGE_RADIUS,
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

/**
 * Whether an AI carrier should stop and shoot of its own accord.
 *
 * Deliberately not the same question as `isShotWorthTaking`, which judges a shot
 * the carrier has already been forced into. This is about a carrier in the clear
 * choosing to pull the trigger rather than keep swimming, and the answer is
 * simply "once you are close enough" — otherwise attackers either shoot from
 * range at every opportunity or carry the ball into the net.
 */
export function shouldStopAndShoot(state: MatchState, carrier: Player): boolean {
  const goalDistance = distanceToOpposingGoal(state, carrier)
  if (goalDistance > SHOOTING_STANDOFF) return false
  // Almost on the goal line there is nothing else to do but shoot.
  if (goalDistance <= SHOOTING_STANDOFF * 0.45) return true
  // Otherwise only pull the trigger on a chance actually worth taking, rather
  // than letting fly the instant the goal comes into range.
  return isShotWorthTaking(state, carrier, goalDistance)
}

/**
 * How many defenders to clear before throwing.
 *
 * The trade FFX offers: endurance spent getting past someone is blocking that
 * never gets counted against the pass or shot. Worth taking when the throw would
 * not survive the crowd otherwise, and not worth it when it would — clearing a
 * defender you did not need to costs endurance that the next challenge will
 * want, and risks losing the ball outright on the way.
 */
export function chooseBreakPast(
  encounter: Encounter,
  carrier: Player,
  stat: 'pa' | 'sh',
): number {
  const defenders = encounter.defenders
  if (defenders.length === 0) return 0

  const power = effectiveStat(carrier, stat)
  const expected = (range: { min: number; max: number }) => (range.min + range.max) / 2

  let endurance = encounter.endurance
  // Judged against the middle of the range rather than the worst case: waiting
  // for a guarantee means never clearing anyone, since a low-level passer cannot
  // beat two defenders' blocking outright however much endurance they spend.
  if (power > expected(blockRange(defenders))) return 0

  for (let count = 1; count <= defenders.length; count++) {
    const next = defenders[count - 1]!
    // Judged on the middle of the tackle too, for the same reason as the block
    // above. Refusing any challenge that *could* take the ball reads as prudent
    // and is in fact total paralysis: a level-one carrier holds EN 2–20 against
    // defenders who tackle at 8–12, so the worst case beats them almost every
    // time and they never clear anyone, ever. They then throw into the full
    // blocking of everyone engaged, which cannot survive either. Choosing
    // between a certain block and a possible tackle, take the tackle.
    const tackle = rollBounds(next.attack)
    const likely = expected(tackle)
    if (endurance - likely <= 0) break

    endurance -= likely
    if (power > expected(blockRange(defenders.slice(count)))) return count
  }

  // Cannot clear enough to make the throw worth more; keep the endurance.
  return 0
}

/**
 * Which tackle technique the defence brings, when nobody is there to choose.
 *
 * Takes the strongest condition it can afford — the point of a tackle technique
 * is what it leaves behind on the player it dispossesses, so there is little
 * reason to hold one back.
 */
export function chooseTackleTechnique(state: MatchState, encounter: Encounter): string | null {
  const available = defensiveTechniques(state, encounter)
  return available[0]?.id ?? null
}
