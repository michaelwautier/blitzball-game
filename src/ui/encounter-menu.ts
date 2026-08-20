import { isCovered } from '../core/ai/decisions'
import {
  allowedActions,
  blockRange,
  defensiveTechniques,
  tackleRange,
} from '../core/encounter/encounter'
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

type Mode = 'defence' | 'actions' | 'passTargets' | 'breakthrough' | 'passTechnique' | 'shootTechnique'

interface Row {
  label: string
  detail: string
  tone: 'safe' | 'risky' | 'neutral'
  /** What choosing it does: commit an action, open a further step, or back out. */
  effect:
    | { commit: EncounterAction }
    | { open: Mode }
    | { cancel: true }
    | { defend: string | null }
  /** Set on pass-target rows, so the receiver survives the steps that follow. */
  targetId?: string
  enabled: boolean
}

export interface EncounterMenuHandlers {
  onAction: (action: EncounterAction) => void
  /** Commit how the user's defenders are challenging. Null is a plain tackle. */
  onDefend: (techniqueId: string | null) => void
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
  /** Which row the arrow keys are sitting on. */
  private selected = 0
  /** Who was on the carrier at the last render, to notice a break landing. */
  private lastDefenders = ''

  constructor(
    private readonly element: HTMLElement,
    private readonly handlers: EncounterMenuHandlers,
  ) {
    this.element.addEventListener('click', this.onClick)
    this.element.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('keydown', this.onKeyDown)
  }

  update(state: MatchState): void {
    if (!this.isOpenFor(state) || state.phase.kind !== 'encounter') {
      if (!this.element.hidden) this.close()
      return
    }

    // Opening fresh: defending comes first when it is being asked, then the
    // target list if passing is the only thing on offer.
    if (this.element.hidden) {
      this.mode = state.phase.encounter.awaitingDefence
        ? 'defence'
        : state.phase.encounter.kind === 'distribution'
          ? 'passTargets'
          : 'actions'
    }

    // The defence answering hands the encounter over to the carrier.
    if (this.mode === 'defence' && !state.phase.encounter.awaitingDefence) {
      this.mode = 'actions'
      this.signature = ''
    }

    // A break landed: fewer defenders than a moment ago, and the encounter is
    // still open. Start the decision again from the top rather than leaving the
    // player staring at the break question they have just answered — with one
    // fewer defender in the way, shooting may now be the thing to do.
    const defenders = state.phase.encounter.defenders.map((d) => d.id).join(',')
    if (defenders !== this.lastDefenders) {
      this.lastDefenders = defenders
      if (this.mode !== 'defence') {
        this.mode = 'actions'
        this.pendingTargetId = null
        this.signature = ''
      }
    }

    const signature = this.signatureFor(state)
    if (signature === this.signature) return

    this.signature = signature
    this.element.hidden = false
    this.render(state)
  }

  /**
   * The teammate currently under the cursor while choosing a pass, if any.
   *
   * Offered so the camera can look at whoever is being considered — a pass is a
   * decision about somewhere else on the pitch, and choosing one from a list of
   * names while staring at the passer is choosing blind.
   *
   * Deliberately a question the renderer asks rather than something written into
   * match state: which row a menu is highlighting is not part of the game.
   */
  previewTargetId(): string | null {
    if (this.element.hidden || this.mode !== 'passTargets') return null
    return this.rows[this.selected]?.targetId ?? null
  }

  dispose(): void {
    this.element.removeEventListener('click', this.onClick)
    this.element.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('keydown', this.onKeyDown)
  }

  /**
   * Open for either side of an encounter: the user's own carrier deciding what
   * to do, or the user's defenders deciding how to challenge.
   */
  private isOpenFor(state: MatchState): boolean {
    if (state.phase.kind !== 'encounter') return false
    if (state.phase.encounter.awaitingDefence) return true

    const carrier = playerById(state, state.phase.encounter.carrierId)
    return carrier?.team === USER_TEAM
  }

  private signatureFor(state: MatchState): string {
    if (state.phase.kind !== 'encounter') return ''
    const { encounter } = state.phase
    return [
      this.mode,
      encounter.kind,
      String(encounter.awaitingDefence),
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
    this.lastDefenders = ''
    this.selected = 0
    this.encounterKind = 'contested'
  }

  private render(state: MatchState): void {
    if (state.phase.kind !== 'encounter') return
    const { encounter } = state.phase
    const carrier = playerById(state, encounter.carrierId)
    if (!carrier) return

    this.encounterKind = encounter.kind
    this.rows = this.buildRows(state, carrier, encounter)
    // A new question starts on its first real answer rather than wherever the
    // highlight happened to be on the last one.
    this.selected = this.firstEnabled()

    const list = document.createElement('ul')
    list.className = 'enc-list'
    this.rows.forEach((row, index) => list.append(this.renderRow(row, index + 1)))

    const hint = document.createElement('div')
    hint.className = 'enc-hint'
    hint.textContent = `↑↓ choose · space to confirm${this.canGoBack() ? ' · Esc back' : ''}`

    this.element.replaceChildren(
      this.renderHeading(state, carrier, encounter),
      this.renderOdds(encounter),
      list,
      hint,
    )
    this.paintSelection()
  }

  private renderHeading(state: MatchState, carrier: Player, encounter: Encounter): HTMLElement {
    const names = encounter.defenders
      .map((d) => playerById(state, d.id)?.def.name ?? '?')
      .join(', ')

    const heading = document.createElement('div')
    heading.className = 'enc-heading'
    heading.textContent = encounter.awaitingDefence
      ? `${carrier.def.name} is coming through — how do you challenge?`
      : encounter.kind === 'contested'
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
      case 'defence':
        return this.defenceRows(state, encounter)
      case 'passTargets':
        return this.passTargetRows(state, carrier)
      case 'breakthrough':
        return this.breakthroughRows(state, encounter)
      case 'passTechnique':
        return this.techniqueRows(carrier, 'pass')
      case 'shootTechnique':
        return this.techniqueRows(carrier, 'shoot')
      case 'actions':
        return this.actionRows(carrier, encounter)
    }
  }

  /**
   * How the user's defenders are coming in.
   *
   * The choice is made before any of the rolls, so it may well land on a
   * different defender than the one who ends up winning the ball. That is the
   * honest shape of it: you commit the defence, then find out who got there.
   */
  private defenceRows(state: MatchState, encounter: Encounter): Row[] {
    const plain: Row = {
      label: 'Tackle',
      detail: 'Win it back and leave it at that',
      tone: 'neutral',
      effect: { defend: null },
      enabled: true,
    }

    const techniques = defensiveTechniques(state, encounter).map((technique) => ({
      label: technique.name,
      detail: `${technique.hpCost} HP · ${technique.description}`,
      tone: 'safe' as const,
      effect: { defend: technique.id },
      enabled: true,
    }))

    return [plain, ...techniques]
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
        // How many to take on is its own question, as it is in FFX.
        effect: { open: 'breakthrough' },
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
      const hasTechniques = techniquesOf(carrier.def.techniques, 'shoot').length > 0
      rows.push({
        label: 'Shoot',
        detail: 'Take on the keeper',
        tone: 'neutral',
        // Straight at goal against whoever is still on them. Clearing a lane
        // first is a breakthrough, made before choosing to shoot at all.
        effect: hasTechniques
          ? { open: 'shootTechnique' }
          : { commit: { kind: 'shoot' as const, techniqueId: null } },
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
   * Where choosing a receiver leads: techniques if they have any, and otherwise
   * straight to the ball.
   */
  private afterTargetChosen(carrier: Player): (targetId: string) => Row['effect'] {
    if (techniquesOf(carrier.def.techniques, 'pass').length > 0) {
      return () => ({ open: 'passTechnique' })
    }
    return (targetId) => ({ commit: { kind: 'pass', targetId, techniqueId: null } })
  }

  /**
   * How many of them to take on.
   *
   * Breaking is a step inside the encounter rather than something bundled onto a
   * throw: beat all of them and the carrier swims on, beat some and they are
   * still caught — by fewer, and it is only the survivors whose blocking counts
   * against whatever they do next. The rows show both sides of that trade.
   */
  private breakthroughRows(state: MatchState, encounter: Encounter): Row[] {
    const stayPut: Row = {
      label: 'No Break',
      detail: 'Think again',
      tone: 'neutral',
      effect: { open: 'actions' },
      enabled: true,
    }

    const breaks = Array.from({ length: encounter.defenders.length }, (_, index) => {
      const count = index + 1
      const cost = tackleRange(encounter.defenders.slice(0, count))
      const facing = blockRange(encounter.defenders.slice(count))
      const clearsEveryone = count === encounter.defenders.length

      return {
        label: `Break to ${this.namesOf(state, encounter, count)}`,
        detail: clearsEveryone
          ? `costs EN ${cost.min}–${cost.max} · free to swim on`
          : `costs EN ${cost.min}–${cost.max} · still facing BL ${facing.min}–${facing.max}`,
        tone: cost.max < encounter.endurance ? ('safe' as const) : ('risky' as const),
        effect: { commit: { kind: 'breakthrough' as const, breakPast: count } },
        // Worth attempting even when it might not come off; refusing anything
        // risky would mean a low-endurance carrier could never break at all.
        enabled: cost.min < encounter.endurance,
      }
    })

    return [stayPut, ...breaks]
  }



  /**
   * The defenders a break of this depth goes through, named.
   *
   * Cumulative and nearest-first, matching how the challenge actually resolves:
   * "Break to Kiyuri" means through everyone up to and including Kiyuri. FFX
   * names them rather than counting them, and with at most two engaged there is
   * always room to.
   */
  private namesOf(state: MatchState, encounter: Encounter, count: number): string {
    const names = encounter.defenders
      .slice(0, count)
      .map((defender) => playerById(state, defender.id)?.def.name ?? '?')

    if (names.length <= 1) return names[0] ?? ''
    return `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`
  }



  /** Assemble a throw from everything gathered across the steps. */
  private throwAction(kind: 'pass' | 'shoot', technique: Technique | null): EncounterAction {
    if (kind === 'shoot') {
      return { kind: 'shoot', techniqueId: technique?.id ?? null }
    }
    return {
      kind: 'pass',
      targetId: this.pendingTargetId ?? '',
      techniqueId: technique?.id ?? null,
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
    // Built as nodes rather than markup: rows carry player names, and names are
    // data. Nothing here should be able to become an element.
    const label = document.createElement('span')
    label.className = 'enc-label'
    label.textContent = row.label
    const detail = document.createElement('span')
    detail.className = 'enc-detail'
    detail.textContent = row.detail

    button.append(label, detail)
    item.append(button)
    return item
  }

  /**
   * Whether Escape has anything to undo: a step to retrace, or — at the top of a
   * menu the user opened themselves — the decision to make one at all. A
   * contested carrier and a keeper are both committed.
   */
  private canGoBack(): boolean {
    // The defence has to answer; there is no declining to be run at.
    if (this.mode === 'defence') return false
    if (this.mode === 'actions') return this.encounterKind === 'onTheBall'
    return !(this.mode === 'passTargets' && this.encounterKind === 'distribution')
  }

  /** Hovering moves the highlight, so mouse and keyboard never disagree. */
  private readonly onPointerMove = (event: PointerEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('.enc-option')
    if (!button?.dataset.key) return

    const index = Number(button.dataset.key) - 1
    if (index === this.selected || !this.rows[index]?.enabled) return

    this.selected = index
    this.paintSelection()
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

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      this.move(event.key === 'ArrowDown' ? 1 : -1)
      event.preventDefault()
      return
    }

    // Space would otherwise scroll the page, and Enter is the other habit.
    if (event.key === ' ' || event.key === 'Enter') {
      this.choose(this.selected + 1)
      event.preventDefault()
    }
  }

  /**
   * Move the highlight, skipping anything that cannot be chosen.
   *
   * Wraps at both ends, which matters more than it sounds: these lists are short
   * and the row you want is as often the last as the first. Disabled rows stay
   * visible — a technique you cannot afford is information — but the highlight
   * does not stop on them, so holding an arrow never gets stuck.
   */
  private move(step: number): void {
    const count = this.rows.length
    if (count === 0) return

    for (let tried = 1; tried <= count; tried++) {
      const next = (this.selected + step * tried + count * count) % count
      if (this.rows[next]?.enabled) {
        this.selected = next
        this.paintSelection()
        return
      }
    }
  }

  /** The first row worth landing on, for when the question changes. */
  private firstEnabled(): number {
    const index = this.rows.findIndex((row) => row.enabled)
    return index < 0 ? 0 : index
  }

  /** Move the highlight without rebuilding the list. */
  private paintSelection(): void {
    this.element.querySelectorAll('.enc-option').forEach((button, index) => {
      button.classList.toggle('enc-selected', index === this.selected)
    })
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
        return 'passTargets'
      case 'shootTechnique':
      case 'breakthrough':
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
    if (row.targetId) this.pendingTargetId = row.targetId

    if ('defend' in row.effect) {
      this.handlers.onDefend(row.effect.defend)
      return
    }

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
