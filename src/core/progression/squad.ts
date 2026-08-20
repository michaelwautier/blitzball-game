import type { TeamDef } from '../../data/types'
import { findPlayer } from '../../data/teams'
import type { MatchState, TeamId } from '../match/types'
import { awardExperience, createCareer, type CareerProgress, type PlayerCareer } from './career'

/**
 * The careers of everyone in a match, carried between matches.
 *
 * Keyed by match-scoped player id (`home:tidus`) so the two sides never collide,
 * even in a mirror fixture where both squads roster the same people.
 */
export class Squad {
  private readonly careers = new Map<string, PlayerCareer>()

  /** The career for a player, created at level one the first time it is asked for. */
  career(playerId: string): PlayerCareer {
    const existing = this.careers.get(playerId)
    if (existing) return existing

    const fresh = createCareer(playerId)
    this.careers.set(playerId, fresh)
    return fresh
  }

  /** Lookup in the shape `createMatch` wants. */
  lookup = (playerId: string): PlayerCareer | undefined => this.career(playerId)

  /**
   * Bank a finished match's experience and level everyone up.
   *
   * Returns what changed for each player who earned anything, ordered by how
   * much they earned, so a summary leads with whoever had the biggest match.
   * Players who did nothing are left out rather than listed with a zero.
   */
  applyMatch(state: MatchState, teams: Record<TeamId, TeamDef>): CareerProgress[] {
    const progress: CareerProgress[] = []

    for (const player of state.players) {
      const earned = state.exp[player.id] ?? 0
      if (earned <= 0) continue

      const def = findPlayer(teams[player.team], player.def.id)
      progress.push(awardExperience(def, this.career(player.id), earned))
    }

    return progress.sort((a, b) => b.expGained - a.expGained)
  }

  /** Every career recorded so far, for saving or inspection. */
  all(): PlayerCareer[] {
    return [...this.careers.values()]
  }
}
