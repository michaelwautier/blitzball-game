import { createLoop } from './core/loop'
import { createMatchState, stepMatch } from './core/match/state'
import { Renderer } from './render/renderer'
import { DebugOverlay } from './ui/debug-overlay'

const canvas = document.querySelector<HTMLCanvasElement>('#game')
const debugElement = document.querySelector<HTMLElement>('#debug')
if (!canvas || !debugElement) throw new Error('Missing #game canvas or #debug overlay')

const renderer = new Renderer(canvas)
const overlay = new DebugOverlay(debugElement)
const state = createMatchState(`blitzball-${Math.floor(Math.random() * 1e9)}`)

const loop = createLoop({
  update: (dt) => stepMatch(state, dt),
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
