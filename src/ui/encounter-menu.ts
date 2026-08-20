import { distanceToOpposingGoal, isCovered } from '../core/ai/decisions'
import { ACTION_HP_COST } from '../core/encounter/formulas'
import { distanceBetween, outfieldTeammates, playerById } from '../core/match/queries'
import { canAfford } from '../core/match/stats'
import { USER_TEAM, type EncounterAction, type MatchState, type Player } from '../core/match/state'
import { techniquesOf, type Technique } from '../data/techniques'

type Mode = 'actions' | 'passTargets' | 'passTechnique' | 'shootTechnique'

interface Row {
  label: string
  detail: string
  tone: 'safe' | 'risky' | 'neutral'
  /** Null when the row opens a submenu rather than committing. */
  action: EncounterAction | null
  enabled: boolean
}

/**
 * The pause-and-menu encounter, in the DOM.
 *
 * It shows what the carrier is actually up against — their endurance against the
 * rolled attack of every defender on them — because the decision is only
 * interesting if the odds are visible. Techniques appear as a second step after
 * choosing pass or shoot, with their HP price attached, so spending stamina is
 * always a deliberate choice rather than something that happens to you.
 *
 * Rebuilt only when the choice on offer changes, not every frame.
 */
export class EncounterMenu {
  private mode: Mode = 'actions'
  private signature = ''
  private rows: Row[] = []
  private pendingTargetId: string | null = null
  /** Whether the carrier has anything to offer at the technique step. */
  private techniqueCounts = { pass: 0, shoot: 0 }

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
      this.pendingTargetId ?? '',
      encounter.carrierId,
      ...encounter.defenders.map((d) => `${d.id}:${d.attack}`),
    ].join('|')
  }

  private close(): void {
    this.element.hidden = true
    this.element.replaceChildren()
    this.mode = 'actions'
    this.signature = ''
    this.rows = []
    this.pendingTargetId = null
  }

  private render(state: MatchState): void {
    if (state.phase.kind !== 'encounter') return
    const { encounter } = state.phase
    const carrier = playerById(state, encounter.carrierId)
    if (!carrier) return

    this.techniqueCounts = {
      pass: techniquesOf(carrier.def.techniques, 'pass').length,
      shoot: techniquesOf(carrier.def.techniques, 'shoot').length,
    }

    const attack = encounter.defenders.reduce((total, d) => total + d.attack, 0)
    const names = encounter.defenders
      .map((d) => playerById(state, d.id)?.def.name ?? '?')
      .join(', ')

    const heading = document.createElement('div')
    heading.className = 'enc-heading'
    heading.textContent = `${carrier.def.name} is caught by ${names}`

    const hp = document.createElement('span')
    hp.className = 'enc-hp'
    hp.textContent = `HP ${Math.round(carrier.hp)}/${carrier.def.stats.hp}`
    heading.append(hp)

    const odds = document.createElement('div')
    odds.className = 'enc-odds'
    const survives = encounter.endurance - attack
    odds.innerHTML =
      `<span class="enc-en">EN ${encounter.endurance}</span>` +
      `<span class="enc-vs">vs</span>` +
      `<span class="enc-at">AT ${attack}</span>` +
      `<span class="enc-outcome ${survives > 0 ? 'good' : 'bad'}">` +
      `${survives > 0 ? `${survives} left` : 'not enough'}</span>`

    this.rows = this.buildRows(state, carrier, encounter.endurance, attack)

    const list = document.createElement('ul')
    list.className = 'enc-list'
    this.rows.forEach((row, index) => list.append(this.renderRow(row, index + 1)))

    const hint = document.createElement('div')
    hint.className = 'enc-hint'
    hint.textContent =
      this.mode === 'actions'
        ? `Press 1–${this.rows.length}, or click`
        : `Press 1–${this.rows.length}, Esc to go back`

    this.element.replaceChildren(heading, odds, list, hint)
  }

  private buildRows(
    state: MatchState,
    carrier: Player,
    endurance: number,
    attack: number,
  ): Row[] {
    switch (this.mode) {
      case 'passTargets':
        return this.passTargetRows(state, carrier)
      case 'passTechnique':
        return this.techniqueRows(carrier, 'pass')
      case 'shootTechnique':
        return this.techniqueRows(carrier, 'shoot')
      case 'actions':
        return this.actionRows(endurance, attack)
    }
  }

  private actionRows(endurance: number, attack: number): Row[] {
    const left = endurance - attack
    return [
      {
        label: 'Breakthrough',
        detail: `EN ${endurance} − AT ${attack} = ${left}`,
        tone: left > 0 ? 'safe' : 'risky',
        action: { kind: 'breakthrough' },
        enabled: true,
      },
      {
        label: 'Pass',
        detail: 'Find a teammate in space',
        tone: 'neutral',
        action: null,
        enabled: true,
      },
      {
        label: 'Shoot',
        detail: 'Take on the keeper',
        tone: 'neutral',
        action: null,
        enabled: true,
      },
    ]
  }

  private passTargetRows(state: MatchState, carrier: Player): Row[] {
    return outfieldTeammates(state, carrier.team, carrier.id)
      .sort((a, b) => distanceToOpposingGoal(state, a) - distanceToOpposingGoal(state, b))
      .map((mate) => {
        const covered = isCovered(state, mate)
        return {
          label: mate.def.name,
          detail: `${mate.slot} · ${distanceBetween(carrier, mate).toFixed(0)}m · ${covered ? 'marked' : 'free'}`,
          tone: covered ? ('risky' as const) : ('safe' as const),
          // Held rather than committed: the technique step comes next.
          action: { kind: 'pass' as const, targetId: mate.id, techniqueId: null },
          enabled: true,
        }
      })
  }

  /** The plain action first, then each learned technique with its HP price. */
  private techniqueRows(carrier: Player, kind: 'pass' | 'shoot'): Row[] {
    const baseCost = ACTION_HP_COST[kind]
    const plain: Row = {
      label: kind === 'pass' ? 'Straight pass' : 'Straight shot',
      detail: `${baseCost} HP`,
      tone: 'neutral',
      action: this.actionFor(kind, null),
      enabled: true,
    }

    const techniques = techniquesOf(carrier.def.techniques, kind).map((technique) => {
      const affordable = canAfford(carrier, baseCost + technique.hpCost)
      return {
        label: technique.name,
        detail: `${baseCost + technique.hpCost} HP · ${technique.description}`,
        tone: affordable ? ('safe' as const) : ('risky' as const),
        action: affordable ? this.actionFor(kind, technique) : null,
        enabled: affordable,
      }
    })

    return [plain, ...techniques]
  }

  private actionFor(kind: 'pass' | 'shoot', technique: Technique | null): EncounterAction {
    if (kind === 'shoot') return { kind: 'shoot', techniqueId: technique?.id ?? null }
    return {
      kind: 'pass',
      targetId: this.pendingTargetId ?? '',
      techniqueId: technique?.id ?? null,
    }
  }

  private renderRow(row: Row, key: number): HTMLElement {
    const item = document.createElement('li')
    const button = document.createElement('button')
    button.className = `enc-option enc-${row.tone}`
    button.dataset.key = String(key)
    button.disabled = !row.enabled
    button.innerHTML =
      `<kbd>${key}</kbd><span class="enc-label">${row.label}</span>` +
      `<span class="enc-detail">${row.detail}</span>`
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

    if (event.key === 'Escape' && this.mode !== 'actions') {
      this.mode = this.mode === 'passTechnique' ? 'passTargets' : 'actions'
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
    const row = this.rows[key - 1]
    if (!row || !row.enabled) return

    if (this.mode === 'actions') {
      if (key === 1) this.onAction({ kind: 'breakthrough' })
      else if (key === 2) this.advanceTo('passTargets')
      // Skip a step that would offer only the plain shot.
      else if (this.techniqueCounts.shoot === 0) {
        this.onAction({ kind: 'shoot', techniqueId: null })
      } else this.advanceTo('shootTechnique')
      return
    }

    if (this.mode === 'passTargets') {
      // Remember who the ball is going to, then offer the pass techniques.
      const action = row.action
      this.pendingTargetId = action?.kind === 'pass' ? action.targetId : null

      if (this.techniqueCounts.pass === 0 && this.pendingTargetId) {
        this.onAction({ kind: 'pass', targetId: this.pendingTargetId, techniqueId: null })
        return
      }
      this.advanceTo('passTechnique')
      return
    }

    if (row.action) this.onAction(row.action)
  }

  private advanceTo(mode: Mode): void {
    this.mode = mode
    this.signature = ''
  }
}
