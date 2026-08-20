import {
  BALL_RADIUS,
  CENTRE_CIRCLE_RADIUS,
  GOAL_HALF_HEIGHT,
  POOL_RADIUS,
  goalLineX,
  type Side,
} from '../core/pitch'
import type { MatchState } from '../core/match/state'

/** Slack around the pool so the boundary glow is not clipped at the canvas edge. */
const VIEW_RADIUS = POOL_RADIUS * 1.06

const COLOURS = {
  background: '#05080f',
  waterCentre: '#0e5c86',
  waterEdge: '#04263f',
  boundary: '#7fd8ff',
  markings: 'rgb(190 235 255 / 0.28)',
  goal: '#ffd479',
  ball: '#ffffff',
} as const

/**
 * Draws the sphere pool and its contents.
 *
 * Everything is drawn in world units: `draw` installs a transform that maps the
 * pool onto the canvas, so geometry here matches `core/pitch` exactly and no
 * call site needs to convert coordinates. Line widths are therefore also in
 * world units.
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D
  /** CSS pixels per world unit, recomputed on resize. */
  private scale = 1
  private width = 0
  private height = 0

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    this.ctx = ctx
    this.resize()
  }

  /** Match the drawing buffer to the element's size and device pixel ratio. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1
    const { clientWidth, clientHeight } = this.canvas
    this.width = clientWidth
    this.height = clientHeight
    this.canvas.width = Math.round(clientWidth * dpr)
    this.canvas.height = Math.round(clientHeight * dpr)
    this.scale = Math.min(clientWidth, clientHeight) / (VIEW_RADIUS * 2)
  }

  draw(state: MatchState, alpha: number): void {
    const { ctx } = this
    const dpr = window.devicePixelRatio || 1

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = COLOURS.background
    ctx.fillRect(0, 0, this.width, this.height)

    // World space: origin at the centre of the canvas, 1 unit = `scale` px.
    ctx.translate(this.width / 2, this.height / 2)
    ctx.scale(this.scale, this.scale)

    this.drawWater()
    this.drawMarkings()
    this.drawGoal('left')
    this.drawGoal('right')
    this.drawBall(state, alpha)
  }

  private drawWater(): void {
    const { ctx } = this
    const water = ctx.createRadialGradient(0, 0, POOL_RADIUS * 0.1, 0, 0, POOL_RADIUS)
    water.addColorStop(0, COLOURS.waterCentre)
    water.addColorStop(1, COLOURS.waterEdge)

    ctx.beginPath()
    ctx.arc(0, 0, POOL_RADIUS, 0, Math.PI * 2)
    ctx.fillStyle = water
    ctx.fill()

    ctx.lineWidth = 0.6
    ctx.strokeStyle = COLOURS.boundary
    ctx.shadowColor = COLOURS.boundary
    ctx.shadowBlur = 18
    ctx.stroke()
    ctx.shadowBlur = 0
  }

  private drawMarkings(): void {
    const { ctx } = this
    ctx.strokeStyle = COLOURS.markings
    ctx.lineWidth = 0.35

    // Halfway line: the vertical diameter.
    ctx.beginPath()
    ctx.moveTo(0, -POOL_RADIUS)
    ctx.lineTo(0, POOL_RADIUS)
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(0, 0, CENTRE_CIRCLE_RADIUS, 0, Math.PI * 2)
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(0, 0, 0.8, 0, Math.PI * 2)
    ctx.fillStyle = COLOURS.markings
    ctx.fill()
  }

  private drawGoal(side: Side): void {
    const { ctx } = this
    const x = goalLineX(side)
    const outward = side === 'left' ? -1 : 1

    ctx.strokeStyle = COLOURS.goal
    ctx.lineWidth = 0.5

    // Goal mouth.
    ctx.beginPath()
    ctx.moveTo(x, -GOAL_HALF_HEIGHT)
    ctx.lineTo(x, GOAL_HALF_HEIGHT)
    ctx.shadowColor = COLOURS.goal
    ctx.shadowBlur = 12
    ctx.stroke()
    ctx.shadowBlur = 0

    // Net, bulging away from the pitch behind the mouth.
    ctx.beginPath()
    ctx.moveTo(x, -GOAL_HALF_HEIGHT)
    ctx.quadraticCurveTo(x + outward * 5, 0, x, GOAL_HALF_HEIGHT)
    ctx.lineWidth = 0.3
    ctx.strokeStyle = 'rgb(255 212 121 / 0.4)'
    ctx.stroke()

    for (const post of [-GOAL_HALF_HEIGHT, GOAL_HALF_HEIGHT]) {
      ctx.beginPath()
      ctx.arc(x, post, 0.7, 0, Math.PI * 2)
      ctx.fillStyle = COLOURS.goal
      ctx.fill()
    }
  }

  private drawBall(state: MatchState, alpha: number): void {
    const { ctx } = this
    const { ball } = state
    // Interpolate between the last two ticks so motion is smooth at any refresh rate.
    const x = ball.prevX + (ball.x - ball.prevX) * alpha
    const y = ball.prevY + (ball.y - ball.prevY) * alpha

    ctx.beginPath()
    ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2)
    ctx.fillStyle = COLOURS.ball
    ctx.shadowColor = COLOURS.boundary
    ctx.shadowBlur = 16
    ctx.fill()
    ctx.shadowBlur = 0
  }
}
