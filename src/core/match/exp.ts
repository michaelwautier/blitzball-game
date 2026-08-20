import { EXP_AWARDS, type ExpReason } from '../progression/awards'
import type { MatchState, Player } from './types'

/**
 * Record experience for something a player just did.
 *
 * Kept as a tiny module of its own so the encounter and flight code can credit
 * players without either of them depending on the progression system, or on
 * each other.
 */
export function awardExp(state: MatchState, player: Player | undefined, reason: ExpReason): void {
  if (!player) return
  state.exp[player.id] = (state.exp[player.id] ?? 0) + EXP_AWARDS[reason]
}

/** Experience this player has earned so far in this match. */
export function expEarned(state: MatchState, playerId: string): number {
  return state.exp[playerId] ?? 0
}
