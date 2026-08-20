import {
  BALL_RADIUS,
  CENTRE_CIRCLE_RADIUS,
  GOAL_HALF_HEIGHT,
  POOL_RADIUS,
  goalLineX,
  type Side,
} from '../core/pitch'
import { PLAYER_RADIUS } from '../core/match/movement'
import type { MatchState, Player } from '../core/match/state'

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
  controlRing: '#ffffff',
  label: 'rgb(255 255 255 / 0.85)',
  danger: '#ff8b7a',
} as const

/**
 * Draws the sphere pool and everything in it.
 *
 * Play is drawn in world units: `draw` installs a transform mapping the pool
 * onto the canvas, so geometry here matches `core/pitch` exactly and no call
 * site converts coordinates. Line widths and font sizes are world units too.
 * The scoreboard is drawn afterwards in screen space so it stays a fixed size.
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

    // Keepers first so outfielders overlap them, not the other way round.
    for (const player of state.players) {
      if (player.slot === 'GK') this.drawPlayer(state, player, alpha)
    }
    for (const player of state.players) {
      if (player.slot !== 'GK') this.drawPlayer(state, player, alpha)
    }

    this.drawEncounterFocus(state)
    this.drawBall(state, alpha)
    this.drawScoreboard(state, dpr)
    this.drawBanner(state, dpr)
  }

  /**
   * Ring the players locked in an encounter, so a frozen frame reads instantly:
   * who has the ball, and who has them cornered.
   */
  private drawEncounterFocus(state: MatchState): void {
    if (state.phase.kind !== 'encounter') return
    const { ctx } = this
    const { encounter } = state.phase

    const carrier = state.players.find((p) => p.id === encounter.carrierId)
    if (carrier) {
      ctx.beginPath()
      ctx.arc(carrier.x, carrier.y, PLAYER_RADIUS + 2.4, 0, Math.PI * 2)
      ctx.strokeStyle = COLOURS.ball
      ctx.lineWidth = 0.45
      ctx.stroke()
    }

    for (const defender of encounter.defenders) {
      const player = state.players.find((p) => p.id === defender.id)
      if (!player) continue

      ctx.beginPath()
      ctx.arc(player.x, player.y, PLAYER_RADIUS + 2, 0, Math.PI * 2)
      ctx.strokeStyle = COLOURS.danger
      ctx.lineWidth = 0.45
      ctx.stroke()

      ctx.font = '600 2.6px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = COLOURS.danger
      ctx.fillText(`AT ${defender.attack}`, player.x, player.y - PLAYER_RADIUS - 3)
    }
  }

  /** Centre-screen message: goals, saves, half time, encounter outcomes. */
  private drawBanner(state: MatchState, dpr: number): void {
    if (!state.announcement) return
    const { ctx } = this
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const emphatic = state.phase.kind === 'celebration' || state.phase.kind === 'fullTime'
    ctx.font = emphatic
      ? '700 48px ui-sans-serif, system-ui, sans-serif'
      : '600 17px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const y = emphatic ? this.height / 2 : this.height - 34
    ctx.fillStyle = 'rgb(0 0 0 / 0.55)'
    const width = ctx.measureText(state.announcement).width + 28
    ctx.fillRect(this.width / 2 - width / 2, y - (emphatic ? 34 : 15), width, emphatic ? 68 : 30)

    ctx.fillStyle = emphatic ? COLOURS.goal : COLOURS.label
    ctx.fillText(state.announcement, this.width / 2, y)
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

  private drawPlayer(state: MatchState, player: Player, alpha: number): void {
    const { ctx } = this
    const x = player.prevX + (player.x - player.prevX) * alpha
    const y = player.prevY + (player.y - player.prevY) * alpha
    const { colours } = state.teams[player.team].def
    const isControlled = player.id === state.controlled
    const hasBall = state.ball.carrier === player.id

    if (isControlled) {
      ctx.beginPath()
      ctx.arc(x, y, PLAYER_RADIUS + 1.3, 0, Math.PI * 2)
      ctx.strokeStyle = COLOURS.controlRing
      ctx.lineWidth = 0.4
      ctx.stroke()
    }

    ctx.beginPath()
    ctx.arc(x, y, PLAYER_RADIUS, 0, Math.PI * 2)
    ctx.fillStyle = colours.primary
    if (hasBall) {
      ctx.shadowColor = colours.primary
      ctx.shadowBlur = 14
    }
    ctx.fill()
    ctx.shadowBlur = 0

    ctx.lineWidth = player.slot === 'GK' ? 0.7 : 0.4
    ctx.strokeStyle = colours.secondary
    ctx.stroke()

    ctx.font = '2.2px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = colours.secondary
    ctx.fillText(player.slot, x, y)

    ctx.font = '2.1px ui-sans-serif, system-ui, sans-serif'
    ctx.fillStyle = COLOURS.label
    ctx.fillText(player.def.name, x, y + PLAYER_RADIUS + 2.2)
  }

  private drawBall(state: MatchState, alpha: number): void {
    const { ctx } = this
    const { ball } = state
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

  /** Screen-space scoreboard, so it keeps a constant size regardless of zoom. */
  private drawScoreboard(state: MatchState, dpr: number): void {
    const { ctx } = this
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const { home, away } = state.teams
    // The clock counts down within the half, and stops while play is stopped.
    const minutes = Math.floor(state.clock / 60)
    const seconds = Math.floor(state.clock % 60)
    const clock = `${minutes}:${seconds.toString().padStart(2, '0')}  ·  H${state.half}`

    ctx.font = '600 18px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    const centre = this.width / 2
    ctx.fillStyle = home.def.colours.primary
    ctx.textAlign = 'right'
    ctx.fillText(`${home.def.abbreviation} ${home.score}`, centre - 22, 18)

    ctx.fillStyle = 'rgb(255 255 255 / 0.5)'
    ctx.textAlign = 'center'
    ctx.fillText('–', centre, 18)

    ctx.fillStyle = away.def.colours.primary
    ctx.textAlign = 'left'
    ctx.fillText(`${away.score} ${away.def.abbreviation}`, centre + 22, 18)

    ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillStyle = 'rgb(255 255 255 / 0.45)'
    ctx.textAlign = 'center'
    ctx.fillText(clock, centre, 42)
  }
}
