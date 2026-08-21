import { growth, player, stats } from './build'
import type { TeamDef } from './types'

/**
 * Four sides that are not in Final Fantasy X.
 *
 * **Everything here is invented.** That is the whole reason this file exists
 * apart from `teams.ts`, which is a transcription of Square's published
 * per-level tables and needs to stay one: the ladder is only evidence about
 * FFX's balance for as long as the numbers going into it are FFX's numbers. Keep
 * the two apart, and a measurement can always be traced back to whichever it
 * came from.
 *
 * They exist because six teams gave the league no range. Besaid are canonically
 * the worst side in Spira and the arc is that you make them good — but with six
 * fixed opponents there was nowhere to climb *from*, only a wall to climb
 * towards. These four span from below Kilika to above the Psyches, so a season
 * has a bottom as well as a top.
 *
 * Calibrated against the real sides rather than guessed, by outfield stat totals
 * at level one:
 *
 *   MII  weakest      EN 30  AT 22  PA 28  BL 18  SH 18   GK CA  4
 *   KIL  (real)       EN 36  AT 29  PA 35  BL 25  SH 23   GK CA  6
 *   MOO  lower-mid    EN 40  AT 31  PA 37  BL 27  SH 28   GK CA  7
 *   LUC  (real)       EN 38  AT 32  PA 38  BL 24  SH 35   GK CA  8
 *   DJO  upper-mid    EN 52  AT 36  PA 44  BL 40  SH 33   GK CA 12
 *   PSY  (real)       EN 49  AT 39  PA 50  BL 54  SH 31   GK CA 18
 *   ZAN  strongest    EN 62  AT 46  PA 56  BL 58  SH 42   GK CA 20
 *
 * Names are from FFX. The Zanarkand Abes are Jecht's own side and are as close
 * to canon as anything here gets; the Mi'ihen squad is the Crusaders and
 * Chocobo Knights from the Highroad, who have no business playing blitzball and
 * are accordingly terrible at it. The rest are Spiran place and aeon names in
 * the shape the real rosters use.
 *
 * Each side is given a stat profile with a character, rather than being flat:
 * a league of differently-shaped opponents is the point of having one.
 */

/**
 * Crusaders and chocobo handlers off the Mi'ihen Highroad.
 *
 * The weakest side in the league by some way — below Kilika, who were the floor
 * until now. Slow, thin everywhere, and Gatta in goal is worse than Keepa.
 */
export const MIIHEN_RUNNERS: TeamDef = {
  id: 'runners',
  name: "Mi'ihen Runners",
  abbreviation: 'MII',
  colours: { primary: '#c9a227', secondary: '#4a3b14' },
  roster: [
    //                                              HP  SPD  EN  AT  PA  BL  SH  CA
    player('gatta', 'Gatta', 'GK', stats(81, 52, 2, 2, 5, 3, 2, 6), growth(45.518, 0, 0.368, 0.201, 0.335, 0.251, 0.016, 0.368)),
    player('luzzu', 'Luzzu', 'LD', stats(110, 54, 3, 8, 4, 5, 1, 1), growth(53.635, 0, 0.285, 0.402, 0.519, 0.318, 0.1, 0.167)),
    player('clasko', 'Clasko', 'RD', stats(125, 54, 7, 5, 8, 5, 3, 1), growth(55.024, 0, 0.418, 0.352, 0.603, 0.335, 0.201, 0.167)),
    player('elma', 'Elma', 'MF', stats(284, 54, 3, 8, 13, 5, 1, 1), growth(47.845, 0, 0.134, 0.368, 0.468, 0.318, 0.117, 0.05)),
    player('lucil', 'Lucil', 'LF', stats(116, 54, 9, 2, 2, 2, 11, 1), growth(55.024, 0, 0.519, 0.402, 0.167, 0.117, 0.519, 0.167)),
    player('shelinda', 'Shelinda', 'RF', stats(123, 54, 10, 3, 3, 4, 8, 1), growth(53.718, 0, 0.603, 0.251, 0.201, 0.117, 0.485, 0.167)),
    player('maroda', 'Maroda', 'MF', stats(114, 54, 5, 5, 5, 4, 3, 1), growth(52.0, 0, 0.33, 0.30, 0.40, 0.25, 0.25, 0.167)),
  ],
  lineup: { GK: 'gatta', LD: 'luzzu', RD: 'clasko', MF: 'elma', LF: 'lucil', RF: 'shelinda' },
}

/**
 * Guado and Hypello from the Moonflow, named for its moonlilies.
 *
 * Sits between Kilika and Luca: a whole side of adequate, with nothing that
 * frightens anybody and nothing that falls over either.
 */
export const MOONFLOW_LILIES: TeamDef = {
  id: 'lilies',
  name: 'Moonflow Lilies',
  abbreviation: 'MOO',
  colours: { primary: '#8f6fd6', secondary: '#241a3d' },
  roster: [
    //                                              HP  SPD  EN  AT  PA  BL  SH  CA
    player('tromell', 'Tromell', 'GK', stats(116, 59, 3, 2, 4, 4, 2, 7), growth(55.408, 0.051, 0.428, 0.164, 0.306, 0.327, 0.163, 0.439)),
    player('jyscal', 'Jyscal', 'LD', stats(132, 60, 4, 9, 6, 6, 1, 1), growth(62.908, 0, 0.327, 0.47, 0.561, 0.439, 0.163, 0.204), ['wither-tackle']),
    player('pyrell', 'Pyrell', 'RD', stats(140, 60, 6, 8, 9, 7, 3, 1), growth(65.02, 0, 0.388, 0.46, 0.602, 0.377, 0.194, 0.204), ['venom-tackle']),
    player('selvi', 'Selvi', 'MF', stats(228, 60, 8, 6, 10, 4, 7, 1), growth(56.826, 0, 0.327, 0.347, 0.418, 0.286, 0.337, 0.133), ['venom-pass']),
    player('muroh', 'Muroh', 'LF', stats(168, 60, 10, 5, 8, 5, 12, 2), growth(62.766, 0.01, 0.572, 0.408, 0.367, 0.327, 0.51, 0.204)),
    player('nimuya', 'Nimuya', 'RF', stats(133, 60, 10, 4, 4, 3, 11, 1), growth(60.408, 0.01, 0.714, 0.255, 0.255, 0.153, 0.52, 0.204), ['venom-shot']),
    player('lucen', 'Lucen', 'MF', stats(130, 60, 6, 6, 6, 5, 4, 1), growth(60.0, 0, 0.38, 0.35, 0.40, 0.30, 0.30, 0.204)),
  ],
  lineup: { GK: 'tromell', LD: 'jyscal', RD: 'pyrell', MF: 'selvi', LF: 'muroh', RF: 'nimuya' },
}

/**
 * The Djose temple side, named for the thunder that never stops there.
 *
 * Between Luca and the Psyches. Blocks hard, tackles hard, and has a keeper
 * worth beating — a side that makes you work for everything.
 */
export const DJOSE_SPARKS: TeamDef = {
  id: 'sparks',
  name: 'Djose Sparks',
  abbreviation: 'DJO',
  colours: { primary: '#4ec3e0', secondary: '#123243' },
  roster: [
    //                                              HP  SPD  EN  AT  PA  BL  SH  CA
    player('rin', 'Rin', 'GK', stats(119, 60, 5, 6, 2, 4, 1, 13), growth(57.928, 0.051, 0.489, 0.174, 0.255, 0.245, 0.255, 0.388)),
    player('gippal', 'Gippal', 'LD', stats(134, 60, 6, 10, 7, 8, 1, 2), growth(58.48, 0, 0.49, 0.48, 0.653, 0.388, 0.153, 0.204), ['venom-tackle']),
    player('ixiro', 'Ixiro', 'RD', stats(121, 60, 6, 10, 11, 9, 1, 1), growth(64.602, 0, 0.388, 0.479, 0.602, 0.337, 0.143, 0.163), ['wither-tackle']),
    player('kelka', 'Kelka', 'MF', stats(173, 60, 10, 7, 9, 7, 8, 1), growth(58.061, 0, 0.51, 0.337, 0.489, 0.327, 0.418, 0.204), ['venom-pass', 'wither-pass']),
    player('torven', 'Torven', 'LF', stats(197, 60, 11, 7, 11, 10, 11, 2), growth(61.398, 0.01, 0.54, 0.286, 0.551, 0.459, 0.5, 0.143), ['nap-shot']),
    player('vanre', 'Vanre', 'RF', stats(158, 60, 11, 3, 7, 7, 13, 1), growth(60.602, 0.01, 0.572, 0.296, 0.469, 0.306, 0.551, 0.133), ['venom-shot']),
    player('djosa', 'Djosa', 'MF', stats(150, 60, 9, 8, 8, 7, 5, 1), growth(60.0, 0, 0.46, 0.40, 0.45, 0.35, 0.30, 0.20)),
  ],
  lineup: { GK: 'rin', LD: 'gippal', RD: 'ixiro', MF: 'kelka', LF: 'torven', RF: 'vanre' },
}

/**
 * Jecht's own side, out of the Zanarkand that Sin dreamed.
 *
 * A rival for the Psyches rather than a wall above them.
 *
 * They were built stronger, and it did not work: at fourteen per cent above the
 * Psyches they went 180-0-0 with twelve goals a match, and even trimmed back
 * they finished a season unbeaten. This engine turns a modest stat edge into a
 * total one — see the note in `PLAN.md` — so "clearly the best" and "never
 * beaten" are very nearly the same setting.
 *
 * Levelled with the Psyches instead, so the title is contested rather than
 * awarded, and beating them is something a season can actually contain.
 */
export const ZANARKAND_ABES: TeamDef = {
  id: 'abes',
  name: 'Zanarkand Abes',
  abbreviation: 'ZAN',
  colours: { primary: '#f0f4ff', secondary: '#1d2a4d' },
  roster: [
    //                                              HP  SPD  EN  AT  PA  BL  SH  CA
    player('yunal', 'Yunal', 'GK', stats(92, 58, 5, 9, 2, 5, 1, 13), growth(69.028, 0, 0.651, 0.302, 0.349, 0.163, 0.233, 0.396)),
    player('zanar', 'Zanar', 'LD', stats(121, 58, 8, 11, 6, 9, 1, 3), growth(64.468, 0, 0.767, 0.581, 0.93, 0.326, 0.116, 0.233)),
    player('lesca', 'Lesca', 'RD', stats(96, 58, 5, 9, 13, 9, 1, 1), growth(75.542, 0, 0.581, 0.535, 0.838, 0.373, 0.163, 0.139)),
    player('kaira', 'Kaira', 'MF', stats(198, 58, 7, 9, 12, 11, 5, 1), growth(69.33, 0, 0.605, 0.489, 0.814, 0.535, 0.349, 0.233), ['venom-pass']),
    player('jecht', 'Jecht', 'LF', stats(178, 58, 13, 5, 8, 11, 11, 1), growth(73.378, 0, 0.651, 0.279, 0.651, 0.465, 0.698, 0.093), ['jecht-shot']),
    player('vegnal', 'Vegnal', 'RF', stats(178, 58, 13, 3, 8, 12, 9, 1), growth(75.124, 0, 0.512, 0.442, 0.767, 0.512, 0.744, 0.07)),
    player('sunel', 'Sunel', 'MF', stats(135, 58, 8, 8, 8, 8, 5, 1), growth(70.0, 0, 0.55, 0.50, 0.70, 0.45, 0.35, 0.20)),
  ],
  lineup: { GK: 'yunal', LD: 'zanar', RD: 'lesca', MF: 'kaira', LF: 'jecht', RF: 'vegnal' },
}

/** Every side that is ours rather than Square's, weakest first. */
export const EXPANSION_TEAMS: readonly TeamDef[] = [
  MIIHEN_RUNNERS,
  MOONFLOW_LILIES,
  DJOSE_SPARKS,
  ZANARKAND_ABES,
]
