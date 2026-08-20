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
  | { kind: 'breakthrough' }
  | { kind: 'pass'; targetId: string; techniqueId: string | null }
  | { kind: 'shoot'; techniqueId: string | null }

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
}

/** A pass or shot travelling, still liable to be contested. */
export interface BallFlight {
  kind: 'pass' | 'shot'
  fromTeam: TeamId
  /** Who launched it, so the credit for it can find them later. */
  passerId: string
  /** Intended receiver for a pass; null for a shot. */
  targetId: string | null
  target: Vec2
  /** Remaining power. Hits zero and the ball drops short. */
  power: number
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
  /** Seconds before defenders may engage again, so a breakthrough has value. */
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
