import type { MatchState } from './types'

/**
 * How long a line of commentary stays on screen.
 *
 * Long enough to read a piece of arithmetic, short enough that the next thing to
 * happen replaces it rather than queueing behind it.
 */
export const ANNOUNCEMENT_SECONDS = 1.8

/** Say what just happened. */
export function announce(state: MatchState, text: string): void {
  state.announcement = text
  state.announcementTimer = ANNOUNCEMENT_SECONDS
}
