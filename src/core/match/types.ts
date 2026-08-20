import type { Rng } from '../rng'
import type { Side, Vec2 } from '../pitch'
import type { PlayerDef, PositionKey, TeamDef } from '../../data/types'
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
  hp: number
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

export interface MatchState {
  /** Simulated seconds since kickoff. */
  elapsed: number
  rng: Rng
  teams: Record<TeamId, TeamState>
  players: Player[]
  ball: Ball
  /** Player the user is steering. */
  controlled: string
  /** Seconds until a loose ball may be collected, so a loss is not undone instantly. */
  pickupCooldown: number
}

/** Everything the simulation needs from the outside world in a tick. */
export interface MatchInput {
  /** Desired swim direction. Magnitude above 1 is clamped. */
  move: Vec2
}

export const NO_INPUT: MatchInput = { move: { x: 0, y: 0 } }
