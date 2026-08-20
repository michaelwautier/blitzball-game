import type { Rng } from '../rng'
import type { Side, Vec2 } from '../pitch'
import type { PlayerDef, PositionKey, TeamDef } from '../../data/types'
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
  /** Doubles as stamina: actions and techniques spend it, poison drains it. */
  hp: number
  /** Conditions currently affecting this player. */
  statuses: StatusEffect[]
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
  /** AT rolled once when the encounter opens, so the odds cannot be re-rolled. */
  attack: number
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
export interface Encounter {
  carrierId: string
  defenders: EncounterDefender[]
  /** Endurance the carrier brings into this exchange. */
  endurance: number
  /** Delay before an AI carrier commits, so its choice is readable. */
  thinkTimer: number
  /**
   * Passing is the only legal action. Set for a keeper restarting play, who
   * distributes from the line rather than dribbling or shooting.
   */
  passOnly: boolean
}

/** A pass or shot travelling, still liable to be contested. */
export interface BallFlight {
  kind: 'pass' | 'shot'
  fromTeam: TeamId
  /** Intended receiver for a pass; null for a shot. */
  targetId: string | null
  target: Vec2
  /** Remaining power. Hits zero and the ball drops short. */
  power: number
  /** Defenders who have already taken their bite, so nobody contests twice. */
  contested: string[]
  /** Technique used to launch it, whose effects apply on contact and arrival. */
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
