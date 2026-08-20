/**
 * What each contested action is worth in experience.
 *
 * Following FFX, experience comes from *doing* rather than from winning: a
 * defender who spends the match tackling improves as much as a forward who
 * scores. The numbers are weighted by how hard the thing is to achieve, so a
 * goal is worth several tackles but tackling is not worthless.
 */
export const EXP_AWARDS = {
  /** Barging past the defenders on you. */
  breakthrough: 3,
  /** Winning the ball off a carrier. */
  tackle: 4,
  /** A pass that reaches its target. */
  pass: 2,
  /** Reading a pass or shot and taking it. */
  interception: 4,
  /** Any attempt on goal, on target or not. */
  shot: 3,
  /** Putting one away. */
  goal: 10,
  /** Keeping one out. */
  save: 5,
} as const

export type ExpReason = keyof typeof EXP_AWARDS
