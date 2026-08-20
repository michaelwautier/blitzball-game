import { createLoop, TICK_SECONDS } from './core/loop'
import {
  cancelActionMenu,
  createMatch,
  requestActionMenu,
  stepMatch,
  submitDefence,
  submitEncounterAction,
  switchControlled,
  type MatchState,
} from './core/match/state'
import { Squad } from './core/progression/squad'
import { BESAID_AUROCHS, LUCA_GOERS } from './data/teams'
import { KeyboardInput } from './input/keyboard'
import { Renderer } from './render/renderer'
import { SceneRenderer } from './render/scene-renderer'
import { DebugOverlay } from './ui/debug-overlay'
import { EncounterMenu } from './ui/encounter-menu'
import { MatchSummary } from './ui/match-summary'
import { Scoreboard } from './ui/scoreboard'

const element = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`Missing ${selector}`)
  return found
}

const scene = new SceneRenderer(element<HTMLCanvasElement>('#game'))
// The same top-down renderer as before, now shrunk into the corner.
const radar = new Renderer(element<HTMLCanvasElement>('#radar'), { compact: true })
const scoreboard = new Scoreboard(element('#scoreboard'), element('#banner'))
const overlay = new DebugOverlay(element('#debug'))
const input = new KeyboardInput()

/**
 * Careers persist across matches for the session, so the "next match" button
 * fields the squad that just played. Phase 4 will put this behind a save file.
 */
const squad = new Squad()

let state = newMatch()
/** Computed once when the match ends, so re-rendering cannot bank it twice. */
let progress: ReturnType<Squad['applyMatch']> | null = null

function newMatch(): MatchState {
  return createMatch(BESAID_AUROCHS, LUCA_GOERS, `blitzball-${Date.now()}`, squad.lookup)
}

const menu = new EncounterMenu(element('#encounter'), {
  onAction: (action) => submitEncounterAction(state, action),
  onDefend: (techniqueId) => submitDefence(state, techniqueId),
  onCancel: () => cancelActionMenu(state),
})

const summary = new MatchSummary(element('#summary'), () => {
  state = newMatch()
  progress = null
})

const loop = createLoop({
  update: (dt) => stepMatch(state, dt, input.read()),
  render: (alpha) => {
    scene.draw(state, alpha, TICK_SECONDS)
    radar.draw(state, alpha)
    scoreboard.update(state)
    menu.update(state)
    summary.update(state, () => {
      // Banked exactly once: the summary asks for this only on the frame the
      // match ends, and the result is held until the next match replaces it.
      progress ??= squad.applyMatch(state, { home: BESAID_AUROCHS, away: LUCA_GOERS })
      return progress
    })
    overlay.update(loop.stats, state)
  },
})

window.addEventListener('resize', () => {
  scene.resize()
  radar.resize()
})
window.addEventListener('keydown', (event) => {
  if (event.key === '~' || event.key === '`') overlay.toggle()

  // Stop and look up. Space would otherwise scroll the page.
  if (event.key === ' ' || event.key === 'Enter') {
    if (requestActionMenu(state)) event.preventDefault()
  }

  // Take the defender best placed to challenge. Tab would otherwise move focus.
  if (event.key === 'Tab' || event.key.toLowerCase() === 'q') {
    switchControlled(state)
    event.preventDefault()
  }
})

// A backgrounded tab stops firing rAF; restart cleanly instead of accumulating time.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) loop.stop()
  else loop.start()
})

loop.start()

// Dev-only console handle, for inspecting or driving a match from devtools.
if (import.meta.env.DEV) {
  Object.assign(window, {
    blitzball: {
      get state() {
        return state
      },
      squad,
      loop,
      input,
      scene,
      radar,
      menu,
      summary,
      stepMatch,
      submitEncounterAction,
      submitDefence,
      requestActionMenu,
      cancelActionMenu,
      switchControlled,
    },
  })
}
