import { createLoop } from './core/loop'
import {
  cancelActionMenu,
  createMatch,
  requestActionMenu,
  stepMatch,
  submitEncounterAction,
} from './core/match/state'
import { BESAID_AUROCHS, LUCA_GOERS } from './data/teams'
import { KeyboardInput } from './input/keyboard'
import { Renderer } from './render/renderer'
import { DebugOverlay } from './ui/debug-overlay'
import { EncounterMenu } from './ui/encounter-menu'

const canvas = document.querySelector<HTMLCanvasElement>('#game')
const debugElement = document.querySelector<HTMLElement>('#debug')
const encounterElement = document.querySelector<HTMLElement>('#encounter')
if (!canvas || !debugElement || !encounterElement) {
  throw new Error('Missing #game canvas, #debug overlay, or #encounter menu')
}

const renderer = new Renderer(canvas)
const overlay = new DebugOverlay(debugElement)
const input = new KeyboardInput()
const state = createMatch(BESAID_AUROCHS, LUCA_GOERS, `blitzball-${Date.now()}`)
const menu = new EncounterMenu(encounterElement, {
  onAction: (action) => submitEncounterAction(state, action),
  onCancel: () => cancelActionMenu(state),
})

const loop = createLoop({
  update: (dt) => stepMatch(state, dt, input.read()),
  render: (alpha) => {
    renderer.draw(state, alpha)
    menu.update(state)
    overlay.update(loop.stats, state)
  },
})

window.addEventListener('resize', () => renderer.resize())
window.addEventListener('keydown', (event) => {
  if (event.key === '~' || event.key === '`') overlay.toggle()

  // Stop and look up. Space would otherwise scroll the page.
  if (event.key === ' ' || event.key === 'Enter') {
    if (requestActionMenu(state)) event.preventDefault()
  }
})

// A backgrounded tab stops firing rAF; restart cleanly instead of accumulating time.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) loop.stop()
  else loop.start()
})

loop.start()

// Dev-only console handle, for inspecting or driving a match from devtools:
//   for (let i = 0; i < 60; i++) blitzball.stepMatch(blitzball.state, 1 / 60, { move: { x: 1, y: 0 } })
//   blitzball.renderer.draw(blitzball.state, 0)
if (import.meta.env.DEV) {
  Object.assign(window, {
    blitzball: {
      state,
      loop,
      input,
      renderer,
      menu,
      stepMatch,
      submitEncounterAction,
      requestActionMenu,
      cancelActionMenu,
    },
  })
}
