import type { PlayerStats, StatusKind, StatusSpec } from '../../data/types'
import type { Player } from './types'

/** A condition currently affecting a player. */
export interface StatusEffect extends StatusSpec {
  /** Seconds left before it wears off. */
  remaining: number
}

/**
 * Conditions inflicted by techniques.
 *
 * Effects are read through `stats.ts` rather than written into a player's stat
 * block, so they are always reversible and a player's printed stats stay the
 * truth about who they are.
 */

/** Apply a condition, refreshing rather than stacking a duplicate. */
export function applyStatus(player: Player, spec: StatusSpec): void {
  const existing = player.statuses.find(
    (s) => s.kind === spec.kind && s.stat === spec.stat,
  )

  if (existing) {
    // Re-applying tops the timer up rather than doubling the effect, so being
    // hit twice by the same technique cannot compound without limit.
    existing.remaining = Math.max(existing.remaining, spec.duration)
    existing.magnitude = Math.max(existing.magnitude, spec.magnitude)
    return
  }

  player.statuses.push({ ...spec, remaining: spec.duration })
}

/** Advance every condition on a player, draining HP for poison and expiring the rest. */
export function tickStatuses(player: Player, dt: number): void {
  if (player.statuses.length === 0) return

  for (const status of player.statuses) {
    status.remaining -= dt
    if (status.kind === 'poison') {
      player.hp = Math.max(0, player.hp - status.magnitude * dt)
    }
  }

  player.statuses = player.statuses.filter((s) => s.remaining > 0)
}

export function hasStatus(player: Player, kind: StatusKind): boolean {
  return player.statuses.some((s) => s.kind === kind)
}

/**
 * How much of `stat` survives this player's wither effects, as a multiplier.
 * Several withers on the same stat multiply, and the result never reaches zero.
 */
export function witherFactor(player: Player, stat: keyof PlayerStats): number {
  let factor = 1
  for (const status of player.statuses) {
    if (status.kind === 'wither' && status.stat === stat) {
      factor *= Math.max(0, 1 - status.magnitude)
    }
  }
  return factor
}

/** Short labels drawn over a player's head. */
export function statusLabels(player: Player): string[] {
  return player.statuses.map((s) =>
    s.kind === 'wither' ? `${s.stat?.toUpperCase() ?? ''}↓` : s.kind === 'poison' ? 'PSN' : 'ZZZ',
  )
}
