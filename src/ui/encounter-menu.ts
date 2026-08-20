import { distanceToOpposingGoal, isCovered } from '../core/ai/decisions'
import { allowedActions } from '../core/encounter/encounter'
import { ACTION_HP_COST } from '../core/encounter/formulas'
import { distanceBetween, outfieldTeammates, playerById } from '../core/match/queries'
import { canAfford } from '../core/match/stats'
import {
  USER_TEAM,
  type Encounter,
  type EncounterAction,
  type MatchState,
  type Player,
} from '../core/match/state'
import { techniquesOf, type Technique } from '../data/techniques'

type Mode = 'actions' | 'passTargets' | 'passTechnique' | 'shootTechnique'

interface Row {
  label: string
  detail: string
  tone: 'safe' | 'risky' | 'neutral'
  /** What choosing it does: commit an action, or open a further step. */
  effect: { commit: EncounterAction } | { open: Mode }
  /** Set on pass-target rows, so the receiver survives the technique step. */
  targetId?: string
  enabled: boolean
}

export interface EncounterMenuHandlers {
  onAction: (action: EncounterAction) => void
  /** Back out of a decision the user opened themselves. */
  onCancel: () => void
}

/**
 * The pause-and-menu decision, in the DOM.
 *
 * It shows what the carrier is actually up against — their endurance against the
 * rolled attack of every defender on them — because the decision is only
 * interesting if the odds are visible. Techniques appear as a further step after
 * choosing pass or shoot, with their HP price attached.
 *
 * The action rows come from `allowedActions`, so the menu and the engine cannot
 * disagree about what is legal: a keeper is offered only passes because a keeper
 * may only pass, not because the menu was separately told to hide the rest.
 *
 * Rebuilt only when the choice on offer changes, not every frame.
 */
export class EncounterMenu {
  private mode: Mode = 'actions'
  private signature = ''
  private rows: Row[] = []
  private pendingTargetId: string | null = null
  private encounterKind: Encounter['kind'] = 'contested'

  constructor(
    private readonly element: HTMLElement,
    private readonly handlers: EncounterMenuHandlers,
  ) {
    this.element.addEventListener('click', this.onClick)
    window.addEventListener('keydown', this.onKeyDown)
  }

  update(state: MatchState): void {
    if (!this.isOpenFor(state) || state.phase.kind !== 'encounter') {
      if (!this.element.hidden) this.close()
      return
    }

    // Opening fresh: start at the target list when passing is the only choice.
    if (this.element.hidden) {
      this.mode = state.phase.encounter.kind === 'distribution' ? 'passTargets' : 'actions'
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

  /** Only open for a decision on a player the user actually controls. */
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
      encounter.kind,
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
    this.encounterKind = 'contested'
  }

  private render(state: MatchState): void {
    if (state.phase.kind !== 'encounter') return
    const { encounter } = state.phase
    const carrier = playerById(state, encounter.carrierId)
    if (!carrier) return

    this.encounterKind = encounter.kind
    const attack = encounter.defenders.reduce((total, d) => total + d.attack, 0)

    this.rows = this.buildRows(state, carrier, encounter, attack)

    const list = document.createElement('ul')
    list.className = 'enc-list'
    this.rows.forEach((row, index) => list.append(this.renderRow(row, index + 1)))

    const hint = document.createElement('div')
    hint.className = 'enc-hint'
    hint.textContent = `Press 1–${this.rows.length}${this.canGoBack() ? ', Esc to go back' : ''}`

    this.element.replaceChildren(
      this.renderHeading(state, carrier, encounter),
      this.renderOdds(encounter, attack),
      list,
      hint,
    )
  }

  private renderHeading(state: MatchState, carrier: Player, encounter: Encounter): HTMLElement {
    const names = encounter.defenders
      .map((d) => playerById(state, d.id)?.def.name ?? '?')
      .join(', ')

    const heading = document.createElement('div')
    heading.className = 'enc-heading'
    heading.textContent =
      encounter.kind === 'contested'
        ? `${carrier.def.name} is caught by ${names}`
        : `${carrier.def.name} has it — find a teammate`

    const hp = document.createElement('span')
    hp.className = 'enc-hp'
    hp.textContent = `HP ${Math.round(carrier.hp)}/${carrier.def.stats.hp}`
    heading.append(hp)

    return heading
  }

  private renderOdds(encounter: Encounter, attack: number): HTMLElement {
    const odds = document.createElement('div')
    odds.className = 'enc-odds'

    if (encounter.kind !== 'contested') {
      odds.innerHTML = `<span class="enc-vs">${
        encounter.kind === 'distribution' ? 'Distributing from the line' : 'In the clear'
      }</span>`
      return odds
    }

    const survives = encounter.endurance - attack
    odds.innerHTML =
      `<span class="enc-en">EN ${encounter.endurance}</span>` +
      `<span class="enc-vs">vs</span>` +
      `<span class="enc-at">AT ${attack}</span>` +
      `<span class="enc-outcome ${survives > 0 ? 'good' : 'bad'}">` +
      `${survives > 0 ? `${survives} left` : 'not enough'}</span>`

    return odds
  }

  private buildRows(
    state: MatchState,
    carrier: Player,
    encounter: Encounter,
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
        return this.actionRows(carrier, encounter, attack)
    }
  }

  /** Built from what the engine permits, so the two cannot disagree. */
  private actionRows(carrier: Player, encounter: Encounter, attack: number): Row[] {
    const rows: Row[] = []
    const permitted = allowedActions(encounter.kind)

    if (permitted.includes('breakthrough')) {
      const left = encounter.endurance - attack
      rows.push({
        label: 'Breakthrough',
        detail: `EN ${encounter.endurance} − AT ${attack} = ${left}`,
        tone: left > 0 ? 'safe' : 'risky',
        effect: { commit: { kind: 'breakthrough' } },
        enabled: true,
      })
    }

    if (permitted.includes('pass')) {
      rows.push({
        label: 'Pass',
        detail: 'Find a teammate in space',
        tone: 'neutral',
        effect: { open: 'passTargets' },
        enabled: true,
      })
    }

    if (permitted.includes('shoot')) {
      // Skip a technique step that would offer only the plain shot.
      const hasTechniques = techniquesOf(carrier.def.techniques, 'shoot').length > 0
      rows.push({
        label: 'Shoot',
        detail: 'Take on the keeper',
        tone: 'neutral',
        effect: hasTechniques
          ? { open: 'shootTechnique' }
          : { commit: { kind: 'shoot', techniqueId: null } },
        enabled: true,
      })
    }

    return rows
  }

  private passTargetRows(state: MatchState, carrier: Player): Row[] {
    const hasTechniques = techniquesOf(carrier.def.techniques, 'pass').length > 0

    return outfieldTeammates(state, carrier.team, carrier.id)
      .sort((a, b) => distanceToOpposingGoal(state, a) - distanceToOpposingGoal(state, b))
      .map((mate) => {
        const covered = isCovered(state, mate)
        return {
          label: mate.def.name,
          detail: `${mate.slot} · ${distanceBetween(carrier, mate).toFixed(0)}m · ${covered ? 'marked' : 'free'}`,
          tone: covered ? ('risky' as const) : ('safe' as const),
          targetId: mate.id,
          effect: hasTechniques
            ? ({ open: 'passTechnique' } as const)
            : ({
                commit: { kind: 'pass' as const, targetId: mate.id, techniqueId: null },
              } as const),
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
      effect: { commit: this.actionFor(kind, null) },
      enabled: true,
    }

    const techniques = techniquesOf(carrier.def.techniques, kind).map((technique) => {
      const affordable = canAfford(carrier, baseCost + technique.hpCost)
      return {
        label: technique.name,
        detail: `${baseCost + technique.hpCost} HP · ${technique.description}`,
        tone: affordable ? ('safe' as const) : ('risky' as const),
        effect: { commit: this.actionFor(kind, technique) },
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

  /**
   * Whether Escape has anything to undo: a step to retrace, or — at the top of a
   * menu the user opened themselves — the decision to make one at all. A
   * contested carrier and a keeper are both committed.
   */
  private canGoBack(): boolean {
    if (this.mode === 'actions') return this.encounterKind === 'onTheBall'
    return !(this.mode === 'passTargets' && this.encounterKind === 'distribution')
  }

  private readonly onClick = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('.enc-option')
    if (!button?.dataset.key) return
    this.choose(Number(button.dataset.key))
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (this.element.hidden) return

    if (event.key === 'Escape') {
      this.goBack()
      event.preventDefault()
      return
    }

    const key = Number(event.key)
    if (Number.isInteger(key) && key >= 1 && key <= 9) {
      this.choose(key)
      event.preventDefault()
    }
  }

  private goBack(): void {
    if (!this.canGoBack()) return

    if (this.mode === 'actions') {
      this.handlers.onCancel()
      return
    }

    this.mode = this.mode === 'passTechnique' ? 'passTargets' : 'actions'
    this.signature = ''
  }

  private choose(key: number): void {
    const row = this.rows[key - 1]
    if (!row || !row.enabled) return

    // Remember the receiver before any technique step overwrites the rows.
    if (row.targetId) this.pendingTargetId = row.targetId

    if ('commit' in row.effect) {
      this.handlers.onAction(row.effect.commit)
      return
    }

    this.mode = row.effect.open
    this.signature = ''
  }
}
