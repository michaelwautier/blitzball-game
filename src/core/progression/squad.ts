import type { TeamDef } from '../../data/types'
import { findPlayer } from '../../data/teams'
import type { CareerLookup } from '../match/state'
import type { MatchState, TeamId } from '../match/types'
import { awardExperience, createCareer, type CareerProgress, type PlayerCareer } from './career'

/**
 * Everyone's career, carried between matches.
 *
 * Keyed by team and player — `aurochs:tidus` — rather than by which end of the
 * pool they lined up at. The engine calls its own sides `home` and `away`, and
 * keying on that was fine while there was one fixture played over and over; in
 * a league the user plays away as well as at home, and their squad's careers
 * would have been split in two, or worse, merged with whoever lined up opposite.
 */
export class Squad {
  private readonly careers = new Map<string, PlayerCareer>()

  constructor(existing: readonly PlayerCareer[] = []) {
    for (const career of existing) this.careers.set(career.playerId, career)
  }

  /** The career for a player, created at level one the first time it is asked for. */
  career(playerId: string): PlayerCareer {
    const existing = this.careers.get(playerId)
    if (existing) return existing

    const fresh = createCareer(playerId)
    this.careers.set(playerId, fresh)
    return fresh
  }

  /**
   * A lookup in the shape `createMatch` wants, for one particular fixture.
   *
   * The engine asks about `home:tidus`; this translates that into whichever
   * squad is actually lining up at that end today.
   */
  lookupFor(teams: Record<TeamId, TeamDef>): CareerLookup {
    return (matchPlayerId: string) => {
      const separator = matchPlayerId.indexOf(':')
      if (separator < 0) return undefined

      const side = matchPlayerId.slice(0, separator) as TeamId
      const team = teams[side]
      if (!team) return undefined

      return this.career(`${team.id}:${matchPlayerId.slice(separator + 1)}`)
    }
  }

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

      const team = teams[player.team]
      const def = findPlayer(team, player.def.id)
      progress.push(
        awardExperience(def, this.career(`${team.id}:${player.def.id}`), earned),
      )
    }

    return progress.sort((a, b) => b.expGained - a.expGained)
  }

  /** Every career recorded so far, for saving or inspection. */
  all(): PlayerCareer[] {
    return [...this.careers.values()]
  }

  /** Just one team's, for a squad screen or a summary. */
  forTeam(teamId: string): PlayerCareer[] {
    return this.all().filter((career) => career.playerId.startsWith(`${teamId}:`))
  }
}
