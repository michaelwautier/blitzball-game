import type { PlayerDef, PlayerStats, TeamDef } from './types'

/**
 * Team and player data, approximating FFX's blitzball rosters at low level.
 *
 * The exact numbers Square used were never published; these are transcribed from
 * community documentation and tuned so the matchups feel right — the Aurochs are
 * an underdog side with one genuine goalscorer in Wakka, the Goers are stronger
 * across the board with a standout striker in Bickson. Balance lives here rather
 * than in the resolution math, so tuning a team never means touching the engine.
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
    //                                        HP   SP  EN  AT  PA  BL  SH  CA
    player('keepa', 'Keepa', 'GK', stats(220, 5, 12, 6, 4, 5, 2, 14), growth(7, 0.1, 0.35, 0.2, 0.15, 0.2, 0.05, 0.6)),
    player('letty', 'Letty', 'LD', stats(180, 7, 9, 9, 5, 9, 5, 1), growth(6, 0.25, 0.3, 0.45, 0.2, 0.45, 0.15, 0.05), ['venom-tackle']),
    player('jassu', 'Jassu', 'RD', stats(190, 7, 10, 8, 7, 10, 4, 1), growth(6, 0.25, 0.3, 0.35, 0.35, 0.5, 0.1, 0.05), ['wither-tackle']),
    player('tidus', 'Tidus', 'MF', stats(200, 12, 8, 4, 5, 2, 12, 1), growth(6, 0.5, 0.35, 0.15, 0.3, 0.1, 0.7, 0.05), ['jecht-shot', 'wither-pass']),
    player('wakka', 'Wakka', 'LF', stats(250, 8, 14, 10, 6, 8, 14, 1), growth(7, 0.2, 0.4, 0.4, 0.25, 0.3, 0.5, 0.05), ['venom-shot', 'venom-pass']),
    player('datto', 'Datto', 'RF', stats(160, 10, 6, 5, 8, 4, 6, 1), growth(4, 0.6, 0.2, 0.15, 0.5, 0.15, 0.2, 0.05), ['wither-pass']),
    player('botta', 'Botta', 'MF', stats(170, 6, 8, 7, 9, 6, 4, 1), growth(5, 0.2, 0.25, 0.25, 0.55, 0.25, 0.15, 0.05)),
  ],
  lineup: { GK: 'keepa', LD: 'letty', RD: 'jassu', MF: 'tidus', LF: 'wakka', RF: 'datto' },
}

export const LUCA_GOERS: TeamDef = {
  id: 'goers',
  name: 'Luca Goers',
  abbreviation: 'LUC',
  colours: { primary: '#e05a47', secondary: '#2b2b33' },
  roster: [
    //                                          HP   SP  EN  AT  PA  BL  SH  CA
    player('raudy', 'Raudy', 'GK', stats(230, 6, 13, 7, 5, 6, 3, 15), growth(7, 0.1, 0.4, 0.2, 0.15, 0.2, 0.05, 0.65)),
    player('doram', 'Doram', 'LD', stats(200, 9, 10, 12, 6, 11, 5, 1), growth(6, 0.25, 0.35, 0.55, 0.2, 0.5, 0.15, 0.05), ['venom-tackle']),
    player('balgerda', 'Balgerda', 'RD', stats(205, 9, 10, 11, 7, 12, 6, 1), growth(6, 0.25, 0.35, 0.5, 0.25, 0.55, 0.15, 0.05), ['wither-tackle']),
    player('bickson', 'Bickson', 'MF', stats(240, 13, 12, 8, 8, 5, 16, 1), growth(7, 0.55, 0.45, 0.3, 0.35, 0.15, 0.75, 0.05), ['sphere-shot', 'nap-shot']),
    player('graav', 'Graav', 'LF', stats(230, 10, 11, 9, 7, 7, 12, 1), growth(7, 0.35, 0.4, 0.35, 0.3, 0.25, 0.55, 0.05), ['venom-shot']),
    player('abus', 'Abus', 'RF', stats(210, 11, 9, 7, 9, 6, 10, 1), growth(6, 0.5, 0.3, 0.25, 0.5, 0.2, 0.4, 0.05), ['venom-pass']),
  ],
  lineup: { GK: 'raudy', LD: 'doram', RD: 'balgerda', MF: 'bickson', LF: 'graav', RF: 'abus' },
}

export const TEAMS: readonly TeamDef[] = [BESAID_AUROCHS, LUCA_GOERS]

export function findPlayer(team: TeamDef, playerId: string): PlayerDef {
  const found = team.roster.find((p) => p.id === playerId)
  if (!found) throw new Error(`${team.name} has no player "${playerId}"`)
  return found
}
