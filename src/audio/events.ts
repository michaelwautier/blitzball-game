import type { MatchPhase, MatchState, TeamId } from '../core/match/types'

/**
 * What just happened, worth hearing.
 *
 * Derived from watching the match rather than emitted by it: `core/` stays a
 * pure simulation that knows nothing about being watched or listened to, exactly
 * as the renderer reads it without being told when to draw. A phase machine and
 * a possession record are enough to say what happened between two frames.
 *
 * Split from the noise-making on purpose. Deciding *that* a tackle landed is
 * logic worth testing; deciding what a tackle should sound like is not.
 */
export type MatchSound =
  | 'pass'
  | 'shot'
  | 'catch'
  | 'goal'
  | 'tackle'
  | 'breakthrough'
  | 'encounter'
  | 'whistle'

/** The little of a match that has to be remembered to hear the next frame. */
export interface AudioSnapshot {
  phase: MatchPhase['kind']
  /** What is in the air, if anything. */
  flight: 'pass' | 'shot' | 'spilled' | null
  carrier: string | null
  carrierTeam: TeamId | null
  /** Whether whoever has it is a keeper, which is what makes a catch a catch. */
  keeperHasIt: boolean
  goals: number
  half: number
}

export function snapshot(state: MatchState): AudioSnapshot {
  const carrier = state.players.find((player) => player.id === state.ball.carrier)
  return {
    phase: state.phase.kind,
    flight: state.phase.kind === 'flight' ? state.phase.flight.kind : null,
    carrier: state.ball.carrier,
    carrierTeam: carrier?.team ?? null,
    keeperHasIt: carrier?.slot === 'GK',
    goals: state.teams.home.score + state.teams.away.score,
    half: state.half,
  }
}

/**
 * Everything audible between one frame and the next.
 *
 * Order matters where two land together: a shot that beats the keeper produces
 * the goal, and one that does not produces the catch, so they are read from the
 * same transition rather than both being announced.
 */
export function soundsBetween(before: AudioSnapshot, now: AudioSnapshot): MatchSound[] {
  const heard: MatchSound[] = []

  // A throw setting off. Read on the way *into* flight, so a pass and a shot are
  // told apart by what was launched rather than by where it ended up.
  if (now.phase === 'flight' && before.phase !== 'flight') {
    if (now.flight === 'shot') heard.push('shot')
    else if (now.flight === 'pass') heard.push('pass')
  }

  if (now.goals > before.goals) heard.push('goal')

  // The keeper claiming it. Not a goal by definition — the two are the opposite
  // ends of the same shot — so this only fires when no goal was scored.
  else if (now.keeperHasIt && !before.keeperHasIt && before.phase === 'flight') {
    heard.push('catch')
  }

  // The ball changing hands in a challenge is a tackle. Elsewhere it is a fumble
  // or an interception, which the throw's own sound has already covered.
  else if (
    changedHands(before, now) &&
    (before.phase === 'challenge' || before.phase === 'encounter')
  ) {
    heard.push('tackle')
  }

  // Out the other side of a challenge still holding it.
  if (before.phase === 'challenge' && now.phase !== 'challenge' && !changedHands(before, now)) {
    heard.push('breakthrough')
  }

  if (now.phase === 'encounter' && before.phase !== 'encounter') heard.push('encounter')

  // The whistle: both ends of the match, the break in the middle, and the
  // restart out of it. The restart matters more than it sounds — a half is five
  // minutes, so without it the first whistle of a match comes five minutes in,
  // and a feature nobody hears for five minutes is one nobody believes works.
  if (now.phase === 'halfTime' && before.phase !== 'halfTime') heard.push('whistle')
  if (before.phase === 'halfTime' && now.phase === 'play') heard.push('whistle')
  if (now.phase === 'fullTime' && before.phase !== 'fullTime') heard.push('whistle')

  return heard
}

function changedHands(before: AudioSnapshot, now: AudioSnapshot): boolean {
  if (!now.carrier || !before.carrier) return false
  return now.carrierTeam !== before.carrierTeam
}
