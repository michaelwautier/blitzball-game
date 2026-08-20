import { effectiveStat } from '../core/match/stats'
import { playerById } from '../core/match/queries'
import type { Encounter, MatchState, Player } from '../core/match/types'
import type { PlayerStats } from '../data/types'

/**
 * The top-right strip: who has the ball, and who is on them.
 *
 * FFX shows the carrier's name and the handful of stats that decide what they
 * can do, with a row beneath for each defender challenging them. It is the
 * closest thing the game has to a scoreboard for the decision in progress.
 *
 * Two choices worth stating, because both could reasonably have gone the other
 * way. The stats shown are *effective* ones — what the player can produce right
 * now, after wither and exhaustion — because those are the numbers the engine
 * will actually roll, and showing the printed stat block while a poisoned player
 * throws at half strength would be a lie. And the defenders' attack and blocking
 * come from the encounter's own snapshot rather than being read live, for the
 * same reason: that snapshot is what gets rolled.
 *
 * Rebuilt only when something it shows has changed.
 */
export class StatPanel {
  private signature = ''

  constructor(private readonly element: HTMLElement) {}

  update(state: MatchState): void {
    const carrier = state.ball.carrier ? playerById(state, state.ball.carrier) : undefined
    const encounter = state.phase.kind === 'encounter' ? state.phase.encounter : undefined

    if (!carrier) {
      if (!this.element.hidden) this.hide()
      return
    }

    const signature = this.signatureFor(carrier, encounter)
    if (signature === this.signature) return

    this.signature = signature
    this.element.hidden = false
    this.element.replaceChildren(
      this.carrierRow(carrier),
      ...this.defenderRows(state, carrier, encounter),
    )
  }

  private hide(): void {
    this.element.hidden = true
    this.element.replaceChildren()
    this.signature = ''
  }

  private signatureFor(carrier: Player, encounter: Encounter | undefined): string {
    const defenders = encounter?.defenders ?? []
    return [
      carrier.id,
      Math.round(carrier.hp),
      ...STATS_ON_THE_BALL.map((key) => effectiveStat(carrier, key)),
      ...defenders.map((d) => `${d.id}:${d.attack}:${d.block}`),
    ].join('|')
  }

  /** Whoever has the ball, either side's — as FFX shows it. */
  private carrierRow(carrier: Player): HTMLElement {
    return row('sp-carrier', carrier.def.name, [
      ['HP', Math.round(carrier.hp)],
      ...STATS_ON_THE_BALL.map(
        (key) => [key.toUpperCase(), effectiveStat(carrier, key)] as const,
      ),
    ])
  }

  /**
   * One row per defender challenging, beneath the carrier.
   *
   * Only their attack and blocking: what threatens a breakthrough, and what
   * threatens a throw. Nothing else about them changes the decision being made.
   */
  private defenderRows(
    state: MatchState,
    carrier: Player,
    encounter: Encounter | undefined,
  ): HTMLElement[] {
    if (!encounter || encounter.carrierId !== carrier.id) return []

    return encounter.defenders.flatMap((engaged) => {
      const defender = playerById(state, engaged.id)
      if (!defender) return []
      return [
        row('sp-defender', defender.def.name, [
          ['HP', Math.round(defender.hp)],
          ['AT', engaged.attack],
          ['BL', engaged.block],
        ]),
      ]
    })
  }
}

/** What matters about the player on the ball, in FFX's order. */
const STATS_ON_THE_BALL: readonly (keyof PlayerStats)[] = ['en', 'pa', 'sh']

type Stat = readonly [string, number]

function row(className: string, name: string, stats: readonly Stat[]): HTMLElement {
  const line = document.createElement('div')
  line.className = `sp-row ${className}`

  const who = document.createElement('span')
  who.className = 'sp-name'
  who.textContent = name
  line.append(who)

  for (const [label, value] of stats) {
    const figure = document.createElement('span')
    figure.className = 'sp-stat'

    const amount = document.createElement('b')
    amount.textContent = String(value)
    const unit = document.createElement('i')
    unit.textContent = label

    figure.append(amount, unit)
    line.append(figure)
  }

  return line
}
