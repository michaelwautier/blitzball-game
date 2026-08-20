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
 *
 * Positions are ours, not Square's: FFX lets any player fill any slot, so each
 * side is lined up by its own stat profile — best catcher in goal, best passer
 * in midfield, the shooters up front and the tacklers at the back.
 *
 * Techniques are each player's *starting* set, narrowed to the ones this game
 * implements. Their key techniques — the ones you learn by playing them — are
 * deliberately left out until there is something to learn them with.
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

export const RONSO_FANGS: TeamDef = {
  id: 'fangs',
  name: 'Ronso Fangs',
  abbreviation: 'RON',
  colours: { primary: '#4a7fc1', secondary: '#1d2733' },
  roster: [
    //                                                  HP  SPD  EN  AT  PA  BL  SH  CA
    player('zamzi', 'Zamzi Ronso', 'GK', stats(339, 40, 15, 2, 2, 7, 1, 9), growth(65.857, 0, 0.143, 0.061, 0.204, 0.551, 0.041, 0.367)),
    player('irga', 'Irga Ronso', 'LD', stats(230, 40, 14, 9, 7, 8, 1, 1), growth(69.918, 0.02, 0.408, 0.449, 0.551, 0.571, 0.163, 0.204), ['wither-tackle']),
    player('nuvy', 'Nuvy Ronso', 'RD', stats(214, 40, 11, 12, 7, 4, 1, 1), growth(58.898, 0.02, 0.449, 0.347, 0.612, 0.449, 0.122, 0.122), ['venom-pass', 'wither-tackle']),
    player('gazna', 'Gazna Ronso', 'MF', stats(389, 40, 20, 7, 11, 5, 4, 1), growth(69.122, 0.02, 0.204, 0.347, 0.49, 0.367, 0.204, 0.204), ['wither-tackle']),
    player('basik', 'Basik Ronso', 'LF', stats(274, 40, 17, 5, 3, 2, 9, 1), growth(61.776, 0.041, 0.51, 0.429, 0.143, 0.306, 0.878, 0.061), ['sphere-shot', 'wither-tackle']),
    player('argai', 'Argai Ronso', 'RF', stats(329, 40, 16, 5, 5, 4, 10, 1), growth(61.776, 0.02, 0.51, 0.306, 0.286, 0.327, 0.98, 0.102)),
  ],
  lineup: { GK: 'zamzi', LD: 'irga', RD: 'nuvy', MF: 'gazna', LF: 'basik', RF: 'argai' },
}

export const GUADO_GLORIES: TeamDef = {
  id: 'glories',
  name: 'Guado Glories',
  abbreviation: 'GUA',
  colours: { primary: '#5fa860', secondary: '#3d2b56' },
  roster: [
    //                                                  HP  SPD  EN  AT  PA  BL  SH  CA
    player('noy', 'Noy Guado', 'GK', stats(100, 62, 2, 2, 2, 4, 1, 9), growth(66.265, 0.02, 0.306, 0.204, 0.306, 0.102, 0.49, 0.449), ['venom-pass', 'wither-pass']),
    player('auda', 'Auda Guado', 'LD', stats(95, 70, 7, 8, 11, 10, 1, 4), growth(61.265, 0.02, 0.306, 0.347, 0.653, 0.449, 0.082, 0.204), ['venom-tackle', 'venom-pass', 'wither-pass']),
    player('pah', 'Pah Guado', 'RD', stats(90, 65, 3, 10, 13, 7, 1, 3), growth(61.837, 0.082, 0.204, 0.224, 0.592, 0.449, 0.041, 0.102), ['venom-tackle', 'wither-tackle']),
    player('navara', 'Navara Guado', 'MF', stats(90, 57, 7, 5, 16, 14, 4, 1), growth(52.551, 0.143, 0.306, 0.347, 0.714, 0.347, 0.306, 0.061), ['venom-pass', 'wither-pass']),
    player('zazi', 'Zazi Guado', 'LF', stats(120, 75, 12, 3, 11, 7, 12, 1), growth(58.061, 0.02, 0.204, 0.102, 0.714, 0.408, 0.531, 0.163), ['wither-pass']),
    player('giera', 'Giera Guado', 'RF', stats(110, 75, 12, 3, 10, 6, 11, 1), growth(60.612, 0.02, 0.204, 0.204, 0.714, 0.49, 0.612, 0.061), ['venom-pass', 'wither-pass']),
  ],
  lineup: { GK: 'noy', LD: 'auda', RD: 'pah', MF: 'navara', LF: 'zazi', RF: 'giera' },
}

export const AL_BHED_PSYCHES: TeamDef = {
  id: 'psyches',
  name: 'Al Bhed Psyches',
  abbreviation: 'PSY',
  colours: { primary: '#9b6dd6', secondary: '#241a33' },
  roster: [
    //                                                  HP  SPD  EN  AT  PA  BL  SH  CA
    player('nimrook', 'Nimrook', 'GK', stats(96, 60, 5, 10, 2, 4, 1, 18), growth(60.551, 0, 0.571, 0.265, 0.306, 0.143, 0.204, 0.347)),
    player('judda', 'Judda', 'LD', stats(125, 60, 9, 11, 7, 10, 1, 3), growth(56.551, 0, 0.673, 0.51, 0.816, 0.286, 0.102, 0.204)),
    player('lakkam', 'Lakkam', 'RD', stats(100, 60, 6, 10, 13, 10, 1, 1), growth(66.265, 0, 0.51, 0.469, 0.735, 0.327, 0.143, 0.122)),
    player('berrik', 'Berrik', 'MF', stats(205, 60, 8, 10, 12, 11, 4, 1), growth(60.816, 0, 0.531, 0.429, 0.714, 0.469, 0.306, 0.204)),
    player('blappa', 'Blappa', 'LF', stats(186, 60, 13, 5, 9, 11, 13, 1), growth(64.367, 0, 0.571, 0.245, 0.571, 0.408, 0.612, 0.082)),
    player('eigaar', 'Eigaar', 'RF', stats(186, 60, 13, 3, 9, 12, 12, 1), growth(65.898, 0, 0.449, 0.388, 0.673, 0.449, 0.653, 0.061), ['nap-shot']),
  ],
  lineup: { GK: 'nimrook', LD: 'judda', RD: 'lakkam', MF: 'berrik', LF: 'blappa', RF: 'eigaar' },
}

export const KILIKA_BEASTS: TeamDef = {
  id: 'beasts',
  name: 'Kilika Beasts',
  abbreviation: 'KIL',
  colours: { primary: '#2fa5a0', secondary: '#20343a' },
  roster: [
    //                                                  HP  SPD  EN  AT  PA  BL  SH  CA
    player('nizarut', 'Nizarut', 'GK', stats(90, 57, 2, 2, 6, 4, 3, 6), growth(55.51, 0, 0.449, 0.245, 0.408, 0.306, 0.02, 0.449)),
    player('deim', 'Deim', 'LD', stats(122, 60, 4, 8, 5, 6, 1, 1), growth(65.408, 0, 0.347, 0.49, 0.633, 0.388, 0.122, 0.204), ['wither-tackle']),
    player('vuroja', 'Vuroja', 'RD', stats(139, 60, 7, 6, 9, 6, 4, 1), growth(67.102, 0, 0.51, 0.429, 0.735, 0.408, 0.245, 0.204), ['venom-pass']),
    player('kulukan', 'Kulukan', 'MF', stats(316, 60, 4, 9, 15, 6, 1, 1), growth(58.347, 0, 0.163, 0.449, 0.571, 0.388, 0.143, 0.061), ['venom-tackle']),
    player('larbeight', 'Larbeight', 'LF', stats(129, 60, 10, 2, 2, 2, 9, 1), growth(67.102, 0, 0.633, 0.49, 0.204, 0.143, 0.633, 0.204), ['venom-shot']),
    player('isken', 'Isken', 'RF', stats(136, 60, 11, 4, 4, 5, 8, 1), growth(65.51, 0, 0.735, 0.306, 0.245, 0.143, 0.592, 0.204), ['venom-shot']),
  ],
  lineup: { GK: 'nizarut', LD: 'deim', RD: 'vuroja', MF: 'kulukan', LF: 'larbeight', RF: 'isken' },
}

export const TEAMS: readonly TeamDef[] = [
  BESAID_AUROCHS,
  LUCA_GOERS,
  RONSO_FANGS,
  GUADO_GLORIES,
  AL_BHED_PSYCHES,
  KILIKA_BEASTS,
]

export function findTeam(teamId: string): TeamDef {
  const found = TEAMS.find((t) => t.id === teamId)
  if (!found) throw new Error(`no team "${teamId}"`)
  return found
}

export function findPlayer(team: TeamDef, playerId: string): PlayerDef {
  const found = team.roster.find((p) => p.id === playerId)
  if (!found) throw new Error(`${team.name} has no player "${playerId}"`)
  return found
}
