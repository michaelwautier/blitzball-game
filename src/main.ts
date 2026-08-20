import { createLoop } from './core/loop'
import { createMatch, stepMatch } from './core/match/state'
import { BESAID_AUROCHS, LUCA_GOERS } from './data/teams'
import { KeyboardInput } from './input/keyboard'
import { Renderer } from './render/renderer'
import { DebugOverlay } from './ui/debug-overlay'

const canvas = document.querySelector<HTMLCanvasElement>('#game')
const debugElement = document.querySelector<HTMLElement>('#debug')
if (!canvas || !debugElement) throw new Error('Missing #game canvas or #debug overlay')

const renderer = new Renderer(canvas)
const overlay = new DebugOverlay(debugElement)
const input = new KeyboardInput()
const state = createMatch(BESAID_AUROCHS, LUCA_GOERS, `blitzball-${Date.now()}`)

const loop = createLoop({
  update: (dt) => stepMatch(state, dt, input.read()),
  render: (alpha) => {
    renderer.draw(state, alpha)
    overlay.update(loop.stats, state)
  },
})

window.addEventListener('resize', () => renderer.resize())
window.addEventListener('keydown', (event) => {
  if (event.key === '~' || event.key === '`') overlay.toggle()
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
  Object.assign(window, { blitzball: { state, loop, input, renderer, stepMatch } })
}
