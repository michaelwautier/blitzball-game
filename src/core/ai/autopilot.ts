import { desiredPosition } from './positioning'
import { ARRIVE_RADIUS } from '../match/movement'
import { playerById } from '../match/queries'
import { NO_INPUT, type MatchInput, type MatchState } from '../match/types'

/**
 * Movement for the user's player when nobody is at the controls.
 *
 * The user-controlled player is steered by input rather than by the AI, so with
 * no input they simply stop — fine on screen, useless when a match is being
 * simulated headlessly. This produces the intent a competent player would give,
 * which lets a match play itself.
 *
 * Phase 4 needs exactly this to simulate the league fixtures the user is not
 * playing in, using the same engine rather than a separate approximation.
 */
export function autoIntent(state: MatchState): MatchInput {
  const player = playerById(state, state.controlled)
  if (!player) return NO_INPUT

  const target = desiredPosition(state, player)
  const dx = target.x - player.x
  const dy = target.y - player.y
  const distance = Math.hypot(dx, dy)

  // Already where they want to be; holding position is the right call.
  if (distance < 0.5) return NO_INPUT

  // Ease off on approach exactly as `steerTowards` does for AI-steered players.
  // A full-throttle intent instead makes the one player under "user" control
  // overshoot every time it marks someone, which measurably cost the user's side
  // matches in mirror simulations between identical teams.
  const throttle = Math.min(1, distance / ARRIVE_RADIUS)
  return { move: { x: (dx / distance) * throttle, y: (dy / distance) * throttle } }
}
