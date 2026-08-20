/** The six positions on the pitch. Every team fields exactly one of each. */
export type PositionKey = 'GK' | 'LD' | 'RD' | 'MF' | 'LF' | 'RF'

export const POSITION_KEYS: readonly PositionKey[] = ['GK', 'LD', 'RD', 'MF', 'LF', 'RF']

/**
 * A player's attributes, following FFX's blitzball stat block.
 *
 * `hp` doubles as stamina: actions and techniques spend it, and a drained player
 * acts at reduced effectiveness. The rest feed encounter resolution directly.
 */
export interface PlayerStats {
  /** Hit points, spent by actions and techniques. */
  hp: number
  /** Swim speed. */
  sp: number
  /** Endurance — resists defenders when breaking through. */
  en: number
  /** Attack — strips endurance, passes, and shots when tackling. */
  at: number
  /** Passing power. */
  pa: number
  /** Blocking, used when intercepting. */
  bl: number
  /** Shooting power. */
  sh: number
  /** Catching, used by keepers to stop shots. */
  ca: number
}

/** Conditions a technique can inflict. */
export type StatusKind = 'poison' | 'sleep' | 'wither'

/** What a technique inflicts, before it is attached to a player as a live effect. */
export interface StatusSpec {
  kind: StatusKind
  /** Seconds the condition lasts. */
  duration: number
  /**
   * Poison: HP drained per second. Sleep: unused. Wither: the fraction of the
   * affected stat that is lost, so 0.4 leaves the player at 60%.
   */
  magnitude: number
  /** Wither only: which stat is sapped. */
  stat?: keyof PlayerStats
}

export interface PlayerDef {
  id: string
  name: string
  /** The position this player is naturally suited to. */
  natural: PositionKey
  /** Base stats at level 1. */
  stats: PlayerStats
  /**
   * Stat points gained per level, as fractions.
   *
   * Fractional so a curve can express "gains SH roughly every other level"
   * without any randomness: the fractions accumulate and the whole part is what
   * a player actually has. This is what makes Tidus grow into a shooter and
   * Jassu into a blocker rather than everyone converging on the same player.
   */
  growth: PlayerStats
  /** Ids of the techniques this player has learned. */
  techniques: readonly string[]
}

export interface TeamDef {
  id: string
  name: string
  /** Short form for the scoreboard. */
  abbreviation: string
  colours: {
    primary: string
    secondary: string
  }
  roster: readonly PlayerDef[]
  /** Which rostered player starts in each position. */
  lineup: Readonly<Record<PositionKey, string>>
}
