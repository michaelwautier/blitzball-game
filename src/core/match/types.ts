import type { Rng } from '../rng'
import type { Side, Vec2 } from '../pitch'
import type { PlayerDef, PlayerStats, PositionKey, TeamDef } from '../../data/types'
import type { Technique } from '../../data/techniques'
import type { StatusEffect } from './status'
import type { Movable } from './movement'

export type TeamId = 'home' | 'away'

/** The side the user plays. */
export const USER_TEAM: TeamId = 'home'

export interface Player extends Movable {
  /** Unique within a match, since both teams could roster the same player id. */
  id: string
  def: PlayerDef
  team: TeamId
  slot: PositionKey
  /**
   * Stats as this player is right now: their base plus whatever their career
   * has earned. Snapshotted when the match is built, so the engine never needs
   * to know that careers exist.
   */
  stats: PlayerStats
  /** Doubles as stamina: actions and techniques spend it, poison drains it. */
  hp: number
  /** Conditions currently affecting this player. */
  statuses: StatusEffect[]
  /**
   * The challenge carrying a beaten defender past the player they went through.
   *
   * Null when they are not mid-tackle. Held as a movement rather than applied as
   * a jump so the renderer interpolates it like any other travel — a defender
   * teleporting from in front of the carrier to behind them reads as a glitch,
   * not as being beaten.
   */
  lunge: Lunge | null
  /**
   * Seconds this player is out of the play, having just been beaten.
   *
   * A tackle that fails carries the defender past the carrier and leaves them
   * turning round. While it runs down they neither swim nor engage, which is
   * what makes getting past someone worth the endurance it costs.
   */
  recovery: number
  /**
   * Seconds before this defender may drag someone into an encounter again.
   *
   * Distinct from `recovery`, and the distinction is the whole point: a
   * defender who has just committed to a carrier and watched the ball leave is
   * not *beaten*, so they keep swimming and chasing — they simply cannot
   * immediately haul the next carrier into another decision.
   *
   * This used to be a single global timer on the match, which blacked out every
   * encounter anywhere in the pool for four seconds after any pass. On the ball
   * that was invisible, because a carrier can always stop and look up. Off it,
   * it meant sitting glued to an opponent unable to do anything at all.
   */
  engageCooldown: number
}

/** A defender's committed challenge, carrying them past the carrier. */
export interface Lunge {
  fromX: number
  fromY: number
  toX: number
  toY: number
  /** Seconds the movement takes. Recovery usually outlasts it. */
  duration: number
  elapsed: number
}

export interface Ball extends Movable {
  /** Id of the player in possession, or null when the ball is loose. */
  carrier: string | null
}

export interface TeamState {
  id: TeamId
  def: TeamDef
  /** Which goal this team defends. They attack the other one. */
  defending: Side
  score: number
}

/**
 * What a carrier can do when defenders close in.
 *
 * `techniqueId` is null for the plain version of an action. Dribbling has no
 * techniques, following FFX — which is why breaking through is always the
 * option that costs nothing but endurance.
 */
export type EncounterAction =
  | { kind: 'breakthrough'; breakPast: BreakPast }
  | { kind: 'pass'; targetId: string; techniqueId: string | null }
  | { kind: 'shoot'; techniqueId: string | null }

/**
 * How many of the defenders on the carrier a breakthrough takes on.
 *
 * FFX lets a carrier break through "as little as one to all" of them, nearest
 * first. Beating everyone frees them to swim on; beating some leaves them still
 * caught, but by fewer — and it is the survivors, and only them, whose blocking
 * counts against whatever is thrown next.
 *
 * That is why breaking is a step *inside* the encounter rather than something
 * bundled onto a pass or a shot. The trade is the same either way — endurance
 * spent clearing the lane against arriving with more of the throw intact — but
 * as a step it is a decision the player watches resolve before making the next
 * one, and there is no way to slip back into open water while anyone is still
 * on you.
 */
export type BreakPast = number

export interface EncounterDefender {
  id: string
  /**
   * The defender's stats as they stand, not rolls of them.
   *
   * Every contest is rolled when it is actually made, so the menu shows the
   * range a carrier is up against rather than promising an outcome: barging
   * through two defenders, or threading a ball past them, is a gamble and should
   * look like one.
   */
  attack: number
  block: number
}

export interface EncounterResult {
  action: EncounterAction['kind']
  success: boolean
  /** Line shown to the player, e.g. "EN 14 − AT 9 = 5 · broke through". */
  summary: string
  /**
   * The encounter is not over: defenders were beaten, but not all of them.
   *
   * The carrier stays caught and decides again, now against fewer. Only a
   * breakthrough that clears everyone — or a throw, which leaves by way of the
   * ball — ends an encounter.
   */
  continues?: boolean
}

/**
 * A carrier caught by defenders. Play freezes until the action is chosen, which
 * is where blitzball stops being a swimming game and becomes a stat contest.
 */
/**
 * Why the decision is open, which determines what may be chosen.
 *
 * - `contested`: defenders have closed the carrier down. Everything is legal.
 * - `onTheBall`: the carrier chose to stop and look up. Nobody is on them, so
 *   there is nothing to break through — pass or shoot.
 * - `distribution`: a keeper restarting play. Passing only.
 */
export type EncounterKind = 'contested' | 'onTheBall' | 'distribution'

export interface Encounter {
  kind: EncounterKind
  carrierId: string
  defenders: EncounterDefender[]
  /** Endurance the carrier brings into this exchange. */
  endurance: number
  /** Delay before an AI carrier commits, so its choice is readable. */
  thinkTimer: number
  /**
   * True while the user's defenders have yet to say how they are challenging.
   *
   * FFX presents an encounter to both sides — "flip stats if you are playing
   * defensively" — so being run at is a decision too, not something that simply
   * happens to you. The carrier does not commit until the defence has answered.
   */
  awaitingDefence: boolean
  /**
   * What the defence committed to, or null if nobody was asked.
   *
   * The distinction matters: "nobody chose" means the AI picks its own
   * technique, whereas a choice of no technique is a plain tackle somebody
   * deliberately went for. Collapsing both into a null id made choosing a plain
   * tackle fire one anyway.
   */
  defence: DefenceChoice | null
}

export interface DefenceChoice {
  /** Null is a plain tackle, deliberately chosen. */
  techniqueId: string | null
}

/** A pass or shot travelling, still liable to be contested. */
export interface BallFlight {
  /**
   * `pass` and `shot` are throws, and resolve when they arrive. `spilled` is the
   * ball travelling on to whoever collects a throw that arrived with nothing
   * left — there is nothing further to contest, only distance to cover.
   */
  kind: 'pass' | 'shot' | 'spilled'
  fromTeam: TeamId
  /** Who launched it, so the credit for it can find them later. */
  passerId: string
  /** Intended receiver for a pass; null for a shot. */
  targetId: string | null
  target: Vec2
  /**
   * Power the throw left the hand with.
   *
   * Spent on arrival rather than drained in the air: a throw always reaches
   * where it was aimed, and distance is settled when it gets there. Draining it
   * mid-flight meant a throw died wherever it ran out and was collected by
   * whoever happened to be standing at that spot — which read as an
   * interception by a defender who, by the rules, cannot intercept.
   */
  power: number
  /** How far it has flown, for the decay charged on arrival. */
  travelled: number
  /** Technique used to launch it, whose effects apply on arrival. */
  technique: Technique | null
  /** Contests still to be waved through, from the technique's `ignoresBlockers`. */
  blockersIgnored: number
}

export type MatchPhase =
  | { kind: 'play' }
  | { kind: 'encounter'; encounter: Encounter }
  | { kind: 'flight'; flight: BallFlight }
  | { kind: 'celebration'; scorer: TeamId; timer: number }
  | { kind: 'halfTime'; timer: number }
  | { kind: 'fullTime' }

export interface MatchState {
  /** Simulated seconds since the match began, including stoppages. */
  elapsed: number
  /** Seconds left in the current half. Frozen while play is stopped. */
  clock: number
  half: 1 | 2
  phase: MatchPhase
  rng: Rng
  teams: Record<TeamId, TeamState>
  players: Player[]
  ball: Ball
  /** Player the user is steering. */
  controlled: string
  /** Seconds until a loose ball may be collected, so a loss is not undone instantly. */
  pickupCooldown: number
  /**
   * Seconds before *anybody* may open an encounter.
   *
   * Kept short, and only for restarts: a kickoff, a keeper's clearance, and the
   * instant after a breakthrough, where an encounter reopening immediately would
   * undo what just happened. Everything else that used to live here is now a
   * cooldown on the individual defenders who committed — see `Player`.
   */
  engageCooldown: number
  /**
   * Endurance left for the current possession, refreshed when it changes hands.
   * Each breakthrough drains it, so a carrier cannot barge through forever.
   */
  endurance: number
  /** Experience earned this match, by player id. */
  exp: Record<string, number>
  /**
   * Most recent notable event, for the on-screen banner. Kept out of the phase
   * machine so a message can outlive the phase that produced it — a shot's
   * summary should still be readable while the ball is in the air.
   */
  announcement: string | null
  announcementTimer: number
}

/** Everything the simulation needs from the outside world in a tick. */
export interface MatchInput {
  /** Desired swim direction. Magnitude above 1 is clamped. */
  move: Vec2
}

export const NO_INPUT: MatchInput = { move: { x: 0, y: 0 } }
