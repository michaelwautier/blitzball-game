import { isCovered } from '../core/ai/decisions'
import { allowedActions, blockRange, tackleRange } from '../core/encounter/encounter'
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

type Mode = 'actions' | 'passTargets' | 'breakPast' | 'passTechnique' | 'shootTechnique'

interface Row {
  label: string
  detail: string
  tone: 'safe' | 'risky' | 'neutral'
  /** What choosing it does: commit an action, open a further step, or back out. */
  effect: { commit: EncounterAction } | { open: Mode } | { cancel: true }
  /** Set on pass-target rows, so the receiver survives the steps that follow. */
  targetId?: string
  /** Set on break-past rows, so the count survives the technique step. */
  breakPast?: number
  /** Set on the pass and shoot rows, so later steps know which throw is coming. */
  throwKind?: 'pass' | 'shoot'
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
  /** Which throw the break-past step is feeding into. */
  private pendingThrow: 'pass' | 'shoot' = 'shoot'
  /** How many defenders the carrier has chosen to clear first. */
  private pendingBreakPast = 0
  private encounterKind: Encounter['kind'] = 'contested'
  private defenderCount = 0

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
      this.pendingBreakPast,
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
    this.pendingBreakPast = 0
    this.encounterKind = 'contested'
  }

  private render(state: MatchState): void {
    if (state.phase.kind !== 'encounter') return
    const { encounter } = state.phase
    const carrier = playerById(state, encounter.carrierId)
    if (!carrier) return

    this.encounterKind = encounter.kind
    this.defenderCount = encounter.defenders.length
    this.rows = this.buildRows(state, carrier, encounter)

    const list = document.createElement('ul')
    list.className = 'enc-list'
    this.rows.forEach((row, index) => list.append(this.renderRow(row, index + 1)))

    const hint = document.createElement('div')
    hint.className = 'enc-hint'
    hint.textContent = `Press 1–${this.rows.length}${this.canGoBack() ? ', Esc to go back' : ''}`

    this.element.replaceChildren(
      this.renderHeading(state, carrier, encounter),
      this.renderOdds(encounter),
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
    hp.textContent = `HP ${Math.round(carrier.hp)}/${carrier.stats.hp}`
    heading.append(hp)

    return heading
  }

  private renderOdds(encounter: Encounter): HTMLElement {
    const odds = document.createElement('div')
    odds.className = 'enc-odds'

    if (encounter.kind !== 'contested') {
      odds.innerHTML = `<span class="enc-vs">${
        encounter.kind === 'distribution' ? 'Distributing from the line' : 'In the clear'
      }</span>`
      return odds
    }

    const { min, max } = tackleRange(encounter.defenders)
    const best = encounter.endurance - min
    const worst = encounter.endurance - max

    odds.innerHTML =
      `<span class="enc-en">EN ${encounter.endurance}</span>` +
      `<span class="enc-vs">vs</span>` +
      `<span class="enc-at">AT ${min === max ? min : `${min}–${max}`}</span>` +
      `<span class="enc-outcome ${outcomeTone(best, worst)}">${describeOdds(best, worst)}</span>`

    return odds
  }

  private buildRows(state: MatchState, carrier: Player, encounter: Encounter): Row[] {
    switch (this.mode) {
      case 'passTargets':
        return this.passTargetRows(state, carrier)
      case 'breakPast':
        return this.breakPastRows(carrier, encounter)
      case 'passTechnique':
        return this.techniqueRows(carrier, 'pass')
      case 'shootTechnique':
        return this.techniqueRows(carrier, 'shoot')
      case 'actions':
        return this.actionRows(carrier, encounter)
    }
  }

  /** Built from what the engine permits, so the two cannot disagree. */
  private actionRows(carrier: Player, encounter: Encounter): Row[] {
    const rows: Row[] = []
    const permitted = allowedActions(encounter.kind)

    if (permitted.includes('breakthrough')) {
      const { min, max } = tackleRange(encounter.defenders)
      const best = encounter.endurance - min
      const worst = encounter.endurance - max
      rows.push({
        label: 'Breakthrough',
        detail: `EN ${encounter.endurance} − AT ${min === max ? min : `${min}–${max}`}`,
        tone: outcomeTone(best, worst) === 'good' ? 'safe' : worst > 0 ? 'neutral' : 'risky',
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
        throwKind: 'pass',
        enabled: true,
      })
    }

    if (permitted.includes('shoot')) {
      rows.push({
        label: 'Shoot',
        detail: 'Take on the keeper',
        tone: 'neutral',
        effect: {
          open:
            encounter.defenders.length > 0
              ? 'breakPast'
              : techniquesOf(carrier.def.techniques, 'shoot').length > 0
                ? 'shootTechnique'
                : 'actions',
        },
        // With nobody on the carrier and no techniques there is nothing left to
        // ask, so the row commits rather than opening a step.
        ...(encounter.defenders.length === 0 &&
        techniquesOf(carrier.def.techniques, 'shoot').length === 0
          ? { effect: { commit: { kind: 'shoot' as const, techniqueId: null, breakPast: 0 } } }
          : {}),
        throwKind: 'shoot',
        enabled: true,
      })
    }

    // Stopping was the player's own choice, so leaving has to be a visible one
    // too. Escape does the same thing, but nothing on screen says so.
    if (encounter.kind === 'onTheBall') {
      rows.push({
        label: 'Keep swimming',
        detail: 'Carry on with the ball',
        tone: 'neutral',
        effect: { cancel: true },
        enabled: true,
      })
    }

    return rows
  }

  private passTargetRows(state: MatchState, carrier: Player): Row[] {
    const next = this.afterTargetChosen(carrier)

    // Nearest first. A pass loses power over the distance it travels, so the
    // top of the list is the safest ball rather than the most ambitious one, and
    // the order matches how the risk actually rises as you read down it.
    return outfieldTeammates(state, carrier.team, carrier.id)
      .sort((a, b) => distanceBetween(carrier, a) - distanceBetween(carrier, b))
      .map((mate) => {
        const covered = isCovered(state, mate)
        return {
          label: mate.def.name,
          detail: `${mate.slot} · ${distanceBetween(carrier, mate).toFixed(0)}m · ${covered ? 'marked' : 'free'}`,
          tone: covered ? ('risky' as const) : ('safe' as const),
          targetId: mate.id,
          effect: next(mate.id),
          enabled: true,
        }
      })
  }

  /**
   * Where choosing a receiver leads: the break-past step if anyone is on the
   * carrier, then techniques if they have any, and otherwise straight to the ball.
   */
  private afterTargetChosen(carrier: Player): (targetId: string) => Row['effect'] {
    if (this.defenderCount > 0) return () => ({ open: 'breakPast' })
    if (techniquesOf(carrier.def.techniques, 'pass').length > 0) {
      return () => ({ open: 'passTechnique' })
    }
    return (targetId) => ({
      commit: { kind: 'pass', targetId, techniqueId: null, breakPast: 0 },
    })
  }

  /**
   * How many defenders to get past before throwing.
   *
   * Clearing someone costs endurance against their attack, and takes their
   * blocking out of the throw that follows. The rows show both sides of that
   * trade, so the decision is made on the numbers rather than on a hunch.
   */
  private breakPastRows(carrier: Player, encounter: Encounter): Row[] {
    const stat = this.pendingThrow === 'pass' ? 'pa' : 'sh'
    const power = carrier.stats[stat]
    const label = stat.toUpperCase()

    // Counts from nobody up to all of them, so the full choice is on offer.
    return Array.from({ length: encounter.defenders.length + 1 }, (_, count) => {
      const cost = tackleRange(encounter.defenders.slice(0, count))
      const facing = blockRange(encounter.defenders.slice(count))
      const survives = power - facing.max > 0

      return {
        label: count === 0 ? 'Throw through them' : `Get past ${count}`,
        detail:
          `${label} ${power} vs BL ${facing.min}–${facing.max}` +
          (count > 0 ? ` · costs EN ${cost.min}–${cost.max}` : ''),
        tone: survives ? ('safe' as const) : ('risky' as const),
        effect: this.afterBreakPastChosen(carrier, count),
        breakPast: count,
        enabled: count === 0 || cost.max < encounter.endurance,
      }
    })
  }

  /**
   * Where choosing how many to clear leads: the technique step if the carrier
   * has any for this throw, and otherwise straight to making it.
   */
  private afterBreakPastChosen(carrier: Player, count: number): Row['effect'] {
    const kind = this.pendingThrow
    if (techniquesOf(carrier.def.techniques, kind).length > 0) {
      return { open: kind === 'pass' ? 'passTechnique' : 'shootTechnique' }
    }
    return { commit: this.throwAction(kind, null, count) }
  }

  /** Assemble a throw from everything gathered across the steps. */
  private throwAction(
    kind: 'pass' | 'shoot',
    technique: Technique | null,
    breakPast = this.pendingBreakPast,
  ): EncounterAction {
    if (kind === 'shoot') {
      return { kind: 'shoot', techniqueId: technique?.id ?? null, breakPast }
    }
    return {
      kind: 'pass',
      targetId: this.pendingTargetId ?? '',
      techniqueId: technique?.id ?? null,
      breakPast,
    }
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
    return this.throwAction(kind, technique)
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

    this.mode = this.previousStep()
    this.signature = ''
  }

  /** One step back through whichever chain of questions is being asked. */
  private previousStep(): Mode {
    switch (this.mode) {
      case 'passTechnique':
      case 'shootTechnique':
        return this.defenderCount > 0
          ? 'breakPast'
          : this.pendingThrow === 'pass'
            ? 'passTargets'
            : 'actions'
      case 'breakPast':
        return this.pendingThrow === 'pass' ? 'passTargets' : 'actions'
      default:
        return 'actions'
    }
  }

  private choose(key: number): void {
    const row = this.rows[key - 1]
    if (!row || !row.enabled) return

    // Remember what each step chose before the next one overwrites the rows.
    // Recorded on selection rather than while building the rows: doing it during
    // the build left the pending throw set to whichever row happened to be
    // constructed last.
    if (row.throwKind) this.pendingThrow = row.throwKind
    if (row.targetId) this.pendingTargetId = row.targetId
    if (row.breakPast !== undefined) this.pendingBreakPast = row.breakPast

    if ('cancel' in row.effect) {
      this.handlers.onCancel()
      return
    }

    if ('commit' in row.effect) {
      this.handlers.onAction(row.effect.commit)
      return
    }

    this.mode = row.effect.open
    this.signature = ''
  }
}

/**
 * How a breakthrough looks before it is attempted.
 *
 * Three honest states rather than two: certain to get through, certain not to,
 * and the interesting middle where it depends on the rolls.
 */
function describeOdds(best: number, worst: number): string {
  if (worst > 0) return `${worst}–${best} left`
  if (best <= 0) return 'not enough'
  return `${best} left at best`
}

function outcomeTone(best: number, worst: number): 'good' | 'bad' | 'mixed' {
  if (worst > 0) return 'good'
  if (best <= 0) return 'bad'
  return 'mixed'
}
