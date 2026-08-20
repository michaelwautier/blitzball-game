import { distanceToOpposingGoal, isCovered } from '../core/ai/decisions'
import { distanceBetween, outfieldTeammates, playerById } from '../core/match/queries'
import { USER_TEAM, type EncounterAction, type MatchState } from '../core/match/state'

type Mode = 'actions' | 'passTargets'

/**
 * The pause-and-menu encounter, in the DOM.
 *
 * It shows what the carrier is actually up against — their endurance against the
 * rolled attack of every defender on them — because the decision is only
 * interesting if the odds are visible. Rebuilt only when the choice on offer
 * changes, not every frame.
 */
export class EncounterMenu {
  private mode: Mode = 'actions'
  private signature = ''
  private targets: string[] = []

  constructor(
    private readonly element: HTMLElement,
    private readonly onAction: (action: EncounterAction) => void,
  ) {
    this.element.addEventListener('click', this.onClick)
    window.addEventListener('keydown', this.onKeyDown)
  }

  update(state: MatchState): void {
    if (!this.isOpenFor(state)) {
      if (!this.element.hidden) this.close()
      return
    }

    const signature = this.signatureFor(state)
    if (signature === this.signature) return

    this.signature = signature
    this.element.hidden = false
    this.render(state)
  }

  dispose(): void {
    this.element.removeEventListener('click', this.onClick)
    window.removeEventListener('keydown', this.onKeyDown)
  }

  /** Only open for an encounter on a player the user actually controls. */
  private isOpenFor(state: MatchState): boolean {
    if (state.phase.kind !== 'encounter') return false
    const carrier = playerById(state, state.phase.encounter.carrierId)
    return carrier?.team === USER_TEAM
  }

  private signatureFor(state: MatchState): string {
    if (state.phase.kind !== 'encounter') return ''
    const { encounter } = state.phase
    return [
      this.mode,
      encounter.carrierId,
      ...encounter.defenders.map((d) => `${d.id}:${d.attack}`),
    ].join('|')
  }

  private close(): void {
    this.element.hidden = true
    this.element.replaceChildren()
    this.mode = 'actions'
    this.signature = ''
    this.targets = []
  }

  private render(state: MatchState): void {
    if (state.phase.kind !== 'encounter') return
    const { encounter } = state.phase
    const carrier = playerById(state, encounter.carrierId)
    if (!carrier) return

    const attack = encounter.defenders.reduce((total, d) => total + d.attack, 0)
    const names = encounter.defenders
      .map((d) => playerById(state, d.id)?.def.name ?? '?')
      .join(', ')

    const heading = document.createElement('div')
    heading.className = 'enc-heading'
    heading.textContent = `${carrier.def.name} is caught by ${names}`

    const odds = document.createElement('div')
    odds.className = 'enc-odds'
    const survives = encounter.endurance - attack
    odds.innerHTML =
      `<span class="enc-en">EN ${encounter.endurance}</span>` +
      `<span class="enc-vs">vs</span>` +
      `<span class="enc-at">AT ${attack}</span>` +
      `<span class="enc-outcome ${survives > 0 ? 'good' : 'bad'}">` +
      `${survives > 0 ? `${survives} left` : 'not enough'}</span>`

    const list = document.createElement('ul')
    list.className = 'enc-list'
    for (const option of this.options(state, encounter.endurance, attack)) {
      list.append(option)
    }

    const hint = document.createElement('div')
    hint.className = 'enc-hint'
    hint.textContent =
      this.mode === 'actions' ? 'Press 1–3, or click' : 'Press 1–5 to pass, Esc to go back'

    this.element.replaceChildren(heading, odds, list, hint)
  }

  private options(state: MatchState, endurance: number, attack: number): HTMLElement[] {
    if (state.phase.kind !== 'encounter') return []

    if (this.mode === 'passTargets') {
      const carrier = playerById(state, state.phase.encounter.carrierId)
      if (!carrier) return []

      const mates = outfieldTeammates(state, carrier.team, carrier.id).sort(
        (a, b) => distanceToOpposingGoal(state, a) - distanceToOpposingGoal(state, b),
      )
      this.targets = mates.map((m) => m.id)

      return mates.map((mate, index) => {
        const covered = isCovered(state, mate)
        const distance = distanceBetween(carrier, mate)
        return this.row(
          index + 1,
          mate.def.name,
          `${mate.slot} · ${distance.toFixed(0)}m · ${covered ? 'marked' : 'free'}`,
          covered ? 'risky' : 'safe',
          { kind: 'pass', targetId: mate.id },
        )
      })
    }

    this.targets = []
    const breakthroughLeft = endurance - attack
    return [
      this.row(
        1,
        'Breakthrough',
        `EN ${endurance} − AT ${attack} = ${breakthroughLeft}`,
        breakthroughLeft > 0 ? 'safe' : 'risky',
        { kind: 'breakthrough' },
      ),
      this.row(2, 'Pass', 'Find a teammate in space', 'neutral', null),
      this.row(3, 'Shoot', 'Take on the keeper', 'neutral', { kind: 'shoot' }),
    ]
  }

  private row(
    key: number,
    label: string,
    detail: string,
    tone: 'safe' | 'risky' | 'neutral',
    action: EncounterAction | null,
  ): HTMLElement {
    const item = document.createElement('li')
    const button = document.createElement('button')
    button.className = `enc-option enc-${tone}`
    button.dataset.key = String(key)
    button.innerHTML =
      `<kbd>${key}</kbd><span class="enc-label">${label}</span>` +
      `<span class="enc-detail">${detail}</span>`
    // A null action means the row opens a submenu rather than committing.
    if (action) button.dataset.action = JSON.stringify(action)
    item.append(button)
    return item
  }

  private readonly onClick = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('.enc-option')
    if (!button?.dataset.key) return
    this.choose(Number(button.dataset.key))
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (this.element.hidden) return

    if (event.key === 'Escape' && this.mode === 'passTargets') {
      this.mode = 'actions'
      this.signature = ''
      event.preventDefault()
      return
    }

    const key = Number(event.key)
    if (Number.isInteger(key) && key >= 1 && key <= 9) {
      this.choose(key)
      event.preventDefault()
    }
  }

  private choose(key: number): void {
    if (this.mode === 'passTargets') {
      const targetId = this.targets[key - 1]
      if (targetId) this.onAction({ kind: 'pass', targetId })
      return
    }

    if (key === 1) this.onAction({ kind: 'breakthrough' })
    else if (key === 2) {
      // Open the target list rather than committing to a pass blindly.
      this.mode = 'passTargets'
      this.signature = ''
    } else if (key === 3) this.onAction({ kind: 'shoot' })
  }
}
