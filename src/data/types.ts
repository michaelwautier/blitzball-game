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

export interface PlayerDef {
  id: string
  name: string
  /** The position this player is naturally suited to. */
  natural: PositionKey
  /** Base stats at level 1. */
  stats: PlayerStats
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
