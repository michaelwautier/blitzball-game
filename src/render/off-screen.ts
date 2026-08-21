/**
 * Where to pin a marker for something the camera cannot see.
 *
 * The camera follows the player you are steering at a fixed stand-off, which is
 * what keeps the controls meaning one thing — but the pool is now 276 units goal
 * to goal against a 51-unit stand-off, so play at the far end is simply not in
 * the frame. Zooming out to fit both would undo the close camera and still fail
 * at the extremes: five times the stand-off reduces everyone to specks.
 *
 * So the ball keeps its place on screen even when it has no place on screen. The
 * marker rides the edge of the frame in the direction of the thing it is
 * pointing at, which is enough to know where play is without moving the camera
 * at all.
 */

export interface EdgeMarker {
  /** Fraction of the viewport, 0 at the left/top edge and 1 at the right/bottom. */
  x: number
  y: number
  /** Radians, 0 pointing right, growing clockwise in screen terms. */
  angle: number
}

/**
 * Pin a projected point to the edge of the frame, or nothing if it is visible.
 *
 * Takes normalised device coordinates — what a 3D projection produces — where
 * both axes run -1 to 1 across the frame and y grows *upwards*. Screen
 * coordinates grow downwards, so the y axis is flipped on the way out.
 *
 * `behind` matters more than it looks. A perspective projection of a point
 * behind the camera comes back mirrored through the origin: a carrier directly
 * behind you projects to the middle of the frame, and a naive reading would say
 * they are visible and dead ahead. Those are pushed outward along the reversed
 * direction instead, so the marker points back the way you came.
 */
export function edgeMarker(
  ndcX: number,
  ndcY: number,
  behind: boolean,
  margin = 0.06,
): EdgeMarker | null {
  const limit = 1 - margin

  if (!behind && Math.abs(ndcX) <= limit && Math.abs(ndcY) <= limit) return null

  // Mirrored back the right way round, and pushed clear of the frame so the
  // scaling below always has a direction to work with.
  let x = behind ? -ndcX : ndcX
  let y = behind ? -ndcY : ndcY

  // Mirrored back inside the frame still carries a bearing — something behind
  // and to your left mirrors to in front and to the right, and reversing it says
  // "left", which is true. Only a point with no bearing at all needs inventing:
  // dead centre and behind, where the projection says nothing whatsoever.
  if (Math.hypot(x, y) < 1e-6) {
    // Straight down, the way you would turn to look back over your shoulder.
    x = 0
    y = -1
  }

  // Scale out to whichever edge is reached first, which keeps the marker on the
  // true bearing rather than snapping it to a corner.
  const reach = Math.max(Math.abs(x), Math.abs(y))
  const scale = limit / reach
  const edgeX = x * scale
  const edgeY = y * scale

  return {
    x: (edgeX + 1) / 2,
    y: (1 - edgeY) / 2,
    angle: Math.atan2(-edgeY, edgeX),
  }
}
