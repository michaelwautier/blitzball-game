import {
  CENTRE_CIRCLE_RADIUS,
  GOAL_HALF_HEIGHT,
  GOAL_X,
  POOL_RADIUS,
  clampToPool,
  type Side,
  type Vec2,
} from '../pitch'
import { PLAYER_RADIUS } from './movement'
import type { PositionKey } from '../../data/types'

/**
 * Formation anchors for a team defending the left goal (and so attacking +x),
 * in world units. Teams defending the right mirror these across x.
 *
 * Anchors are where a player drifts back to when nothing is demanding their
 * attention; `desiredPosition` in the AI shifts them around play from here.
 */
const ANCHORS: Readonly<Record<PositionKey, Vec2>> = {
  GK: { x: -GOAL_X + POOL_RADIUS * 0.06, y: 0 },
  LD: { x: POOL_RADIUS * -0.52, y: POOL_RADIUS * -0.26 },
  RD: { x: POOL_RADIUS * -0.52, y: POOL_RADIUS * 0.26 },
  MF: { x: POOL_RADIUS * -0.08, y: 0 },
  LF: { x: POOL_RADIUS * 0.36, y: POOL_RADIUS * -0.3 },
  RF: { x: POOL_RADIUS * 0.36, y: POOL_RADIUS * 0.3 },
}

/** Where a player in `slot` sits when their team defends `defending`. */
export function anchorFor(slot: PositionKey, defending: Side): Vec2 {
  const base = ANCHORS[slot]
  return defending === 'left' ? { ...base } : { x: -base.x, y: base.y }
}

/** The direction along x that a team defending `defending` attacks in. */
export function attackDirection(defending: Side): 1 | -1 {
  return defending === 'left' ? 1 : -1
}

/** Closest to the halfway line anyone may line up, so the centre circle stays clear. */
const KICKOFF_STANDOFF = CENTRE_CIRCLE_RADIUS + 1

/**
 * Kickoff positions: formation anchors pulled back into a team's own half.
 *
 * Forwards are anchored in the opposition half during open play, so a fixed
 * pullback is not enough on its own — the result is also clamped to the team's
 * own side of the halfway line.
 */
export function kickoffPosition(slot: PositionKey, defending: Side): Vec2 {
  const anchor = anchorFor(slot, defending)
  const towardsOwnGoal = -attackDirection(defending)
  const pullback = slot === 'GK' ? 0 : POOL_RADIUS * 0.2
  const x = anchor.x + towardsOwnGoal * pullback

  const ownHalf =
    defending === 'left' ? Math.min(x, -KICKOFF_STANDOFF) : Math.max(x, KICKOFF_STANDOFF)

  return clampToPool({ x: ownHalf, y: anchor.y }, PLAYER_RADIUS)
}

/** Keepers hold the goal line rather than roaming; they only track the ball's y. */
export function keeperPosition(defending: Side, ballY: number): Vec2 {
  const anchor = anchorFor('GK', defending)
  const reach = GOAL_HALF_HEIGHT * 1.25
  return {
    x: anchor.x,
    y: Math.max(-reach, Math.min(reach, ballY)),
  }
}

/** Guard rail for the anchor table: every slot must sit inside the pool. */
export function allAnchorsInsidePool(): boolean {
  return Object.values(ANCHORS).every(({ x, y }) => Math.hypot(x, y) < POOL_RADIUS)
}
