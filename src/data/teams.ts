import type { PlayerDef, PlayerStats, TeamDef } from './types'

/**
 * Team and player data, taken from FFX's own tables.
 *
 * Level-one stats and growth curves are transcribed from the published per-level
 * data rather than invented, so the sides are as unbalanced — or as even — as
 * Square made them, and the numbers the formulas operate on are the ones those
 * formulas were designed around.
 *
 * Growth is the average gain per level between level 1 and level 50, which is
 * the range a proof of concept will ever reach. Several players have a flat
 * speed curve; that is the real data, not a gap in it.
 */

const stats = (
  hp: number,
  sp: number,
  en: number,
  at: number,
  pa: number,
  bl: number,
  sh: number,
  ca: number,
): PlayerStats => ({ hp, sp, en, at, pa, bl, sh, ca })

/** Stat points gained per level, in the same order as `stats`. */
const growth = (
  hp: number,
  sp: number,
  en: number,
  at: number,
  pa: number,
  bl: number,
  sh: number,
  ca: number,
): PlayerStats => ({ hp, sp, en, at, pa, bl, sh, ca })

const player = (
  id: string,
  name: string,
  natural: PlayerDef['natural'],
  s: PlayerStats,
  g: PlayerStats,
  techniques: readonly string[] = [],
): PlayerDef => ({ id, name, natural, stats: s, growth: g, techniques })

export const BESAID_AUROCHS: TeamDef = {
  id: 'aurochs',
  name: 'Besaid Aurochs',
  abbreviation: 'BES',
  colours: { primary: '#f2c14e', secondary: '#1c3f6e' },
  roster: [
    //                                              HP  SPD  EN  AT  PA  BL  SH  CA
    player('keepa', 'Keepa', 'GK', stats(90, 54, 4, 2, 2, 4, 1, 5), growth(60.918, 0, 0.367, 0.102, 0.224, 0.265, 0.061, 0.531)),
    player('letty', 'Letty', 'LD', stats(95, 60, 7, 5, 10, 5, 4, 1), growth(61.163, 0, 0.449, 0.265, 0.673, 0.347, 0.306, 0.204), ['venom-tackle']),
    player('jassu', 'Jassu', 'RD', stats(100, 63, 7, 10, 7, 5, 1, 1), growth(69.796, 0.041, 0.49, 0.306, 0.408, 0.327, 0.204, 0.204), ['wither-tackle']),
    player('tidus', 'Tidus', 'MF', stats(132, 60, 10, 3, 3, 2, 10, 1), growth(65.612, 0.082, 0.714, 0.204, 0.408, 0.184, 0.796, 0.204), ['jecht-shot', 'wither-pass']),
    player('wakka', 'Wakka', 'LF', stats(150, 60, 11, 3, 3, 2, 13, 1), growth(56.531, 0, 0.592, 0.143, 0.327, 0.102, 0.673, 0.204), ['venom-shot', 'venom-pass']),
    player('datto', 'Datto', 'RF', stats(90, 60, 12, 2, 4, 2, 8, 1), growth(56.367, 0.551, 0.592, 0.204, 0.306, 0.143, 0.551, 0.204), ['wither-pass']),
    player('botta', 'Botta', 'MF', stats(105, 60, 3, 10, 6, 5, 1, 1), growth(66.286, 0, 0.265, 0.286, 0.245, 0.51, 0.224, 0.204)),
  ],
  lineup: { GK: 'keepa', LD: 'letty', RD: 'jassu', MF: 'tidus', LF: 'wakka', RF: 'datto' },
}

export const LUCA_GOERS: TeamDef = {
  id: 'goers',
  name: 'Luca Goers',
  abbreviation: 'LUC',
  colours: { primary: '#e05a47', secondary: '#2b2b33' },
  roster: [
    //                                                  HP  SPD  EN  AT  PA  BL  SH  CA
    player('raudy', 'Raudy', 'GK', stats(142, 60, 4, 2, 2, 4, 1, 8), growth(55.306, 0.102, 0.408, 0.082, 0.204, 0.347, 0.306, 0.429)),
    player('doram', 'Doram', 'LD', stats(142, 60, 3, 9, 7, 5, 1, 1), growth(60.408, 0, 0.306, 0.449, 0.49, 0.49, 0.204, 0.204), ['venom-tackle']),
    player('balgerda', 'Balgerda', 'RD', stats(141, 60, 5, 9, 9, 8, 1, 1), growth(62.939, 0, 0.265, 0.49, 0.469, 0.347, 0.143, 0.204), ['wither-tackle']),
    player('bickson', 'Bickson', 'MF', stats(140, 60, 12, 3, 5, 2, 12, 1), growth(55.306, 0, 0.49, 0.245, 0.265, 0.184, 0.531, 0.204), ['sphere-shot', 'nap-shot']),
    player('graav', 'Graav', 'LF', stats(207, 60, 9, 8, 13, 8, 8, 2), growth(58.429, 0.02, 0.51, 0.327, 0.531, 0.51, 0.388, 0.204), ['venom-shot']),
    player('abus', 'Abus', 'RF', stats(130, 60, 9, 3, 4, 1, 13, 1), growth(55.306, 0.02, 0.694, 0.204, 0.265, 0.163, 0.449, 0.204), ['venom-pass']),
  ],
  lineup: { GK: 'raudy', LD: 'doram', RD: 'balgerda', MF: 'bickson', LF: 'graav', RF: 'abus' },
}

export const TEAMS: readonly TeamDef[] = [BESAID_AUROCHS, LUCA_GOERS]

export function findPlayer(team: TeamDef, playerId: string): PlayerDef {
  const found = team.roster.find((p) => p.id === playerId)
  if (!found) throw new Error(`${team.name} has no player "${playerId}"`)
  return found
}
