import * as THREE from 'three'
import {
  BALL_RADIUS,
  CENTRE_CIRCLE_RADIUS,
  GOAL_HALF_HEIGHT,
  POOL_RADIUS,
  goalLineX,
  type Side,
} from '../core/pitch'
import { PLAYER_RADIUS } from '../core/match/movement'
import { statusLabels } from '../core/match/status'
import { isExhausted } from '../core/match/stats'
import { carrierOf, opponentOf, playerById } from '../core/match/queries'
import { USER_TEAM, type MatchState, type Player } from '../core/match/state'
import { interpolateToScene } from './projection'

const COLOURS = {
  background: 0x05080f,
  water: 0x1a6ea8,
  surface: 0x9fe8ff,
  markings: 0xbfe9ff,
  goal: 0xffd479,
  ball: 0xffffff,
  control: 0xffffff,
  danger: 0xff8b7a,
} as const

/**
 * The broadcast camera, all as fractions of the pool so a resized pitch keeps
 * the same framing.
 *
 * Low and back, looking across the water rather than down onto it — the angle a
 * touchline camera takes, which is what puts the far wall of the sphere on the
 * horizon instead of filling the frame with pitch.
 */
const CAMERA_HEIGHT = POOL_RADIUS * 0.3
const CAMERA_BACK = POOL_RADIUS * 0.58

/** How far the camera sits behind play, along the line to the goal. */
const CAMERA_TRAIL = POOL_RADIUS * 0.1

/**
 * How far ahead of the player the camera looks.
 *
 * Deliberately slight. Pointing hard at the goal under threat made the whole
 * scene yaw every time possession changed; as a gentle bias it reads as the
 * camera favouring the direction of play without anyone noticing it move.
 */
const CAMERA_LEAD = POOL_RADIUS * 0.1

/** How much of play's travel across the pool the camera follows. */
const DEPTH_FOLLOW = 0.35

/** Seconds for the camera to cover most of the distance to where it wants to be. */
const CAMERA_EASE = 0.5

/**
 * The pool in three dimensions.
 *
 * The simulation stays flat — this draws its plane inside a sphere of water and
 * puts a camera in front of it, which is the view FFX presents. Play therefore
 * reads the same as it always did; what changes is that there is now a volume
 * around it, and perspective that makes the far side of the pool sit further
 * away than the near side.
 *
 * Meshes are created once per player and reused. Rebuilding the scene each frame
 * would be the obvious way to write this and the wrong one: the geometry never
 * changes, only where it is.
 */
export class SceneRenderer {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly bodies = new Map<string, PlayerBody>()
  private readonly ball: THREE.Mesh
  private readonly cameraTarget = new THREE.Vector3()
  private readonly cameraGoal = new THREE.Vector3()
  private readonly lookGoal = new THREE.Vector3()
  private started = false

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setClearColor(COLOURS.background, 1)

    this.camera = new THREE.PerspectiveCamera(55, 1, 1, 800)
    this.camera.position.set(0, CAMERA_HEIGHT, CAMERA_BACK)

    this.buildLighting()
    this.buildPool()
    this.buildMarkings()
    this.buildGoal('left')
    this.buildGoal('right')

    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 20, 16),
      new THREE.MeshStandardMaterial({
        color: COLOURS.ball,
        emissive: COLOURS.ball,
        emissiveIntensity: 0.5,
        roughness: 0.4,
      }),
    )
    this.scene.add(this.ball)

    this.resize()
  }

  resize(): void {
    const { clientWidth, clientHeight } = this.canvas
    if (clientWidth === 0 || clientHeight === 0) return

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(clientWidth, clientHeight, false)
    this.camera.aspect = clientWidth / clientHeight
    // Widen on a narrow window so roughly the same amount of pool stays visible.
    this.camera.fov = this.camera.aspect < 1.2 ? 68 : 55
    this.camera.updateProjectionMatrix()
  }

  draw(state: MatchState, alpha: number, dt = 1 / 60): void {
    for (const player of state.players) this.drawPlayer(state, player, alpha)

    const ball = interpolateToScene(
      { x: state.ball.prevX, y: state.ball.prevY },
      state.ball,
      alpha,
    )
    this.ball.position.set(ball.x, ball.y, ball.z)

    this.followPlayer(state, dt)
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.renderer.dispose()
  }

  /**
   * Track the player being controlled, from the touchline.
   *
   * The camera slides along with play at a fixed height and distance, the way a
   * broadcast camera pans, rather than orbiting behind whoever has the ball. The
   * goal under threat — the one defended by whichever side does *not* have
   * possession — only biases where it sits and what it looks at, by a fraction
   * of the pool. Turning hard towards it made the entire scene yaw whenever
   * possession changed, which is the kind of camera movement that makes a game
   * unpleasant to watch.
   *
   * Travel across the pool is damped, so the camera drifts in and out a little
   * with play instead of matching it and making the horizon heave.
   */
  private followPlayer(state: MatchState, dt: number): void {
    const focusPlayer = playerById(state, state.controlled) ?? state.players[0]
    if (!focusPlayer) return

    const focus = interpolateToScene(focusPlayer, focusPlayer, 1)
    const towards = Math.sign(threatenedGoalX(state) - focus.x) || 1

    this.cameraGoal.set(
      focus.x - towards * CAMERA_TRAIL,
      CAMERA_HEIGHT,
      focus.z * DEPTH_FOLLOW + CAMERA_BACK,
    )
    // Aim a little beyond play, so the pitch sits in the middle of the frame
    // rather than riding high with empty water in the foreground.
    this.lookGoal.set(
      focus.x + towards * CAMERA_LEAD,
      0,
      focus.z * DEPTH_FOLLOW - POOL_RADIUS * 0.1,
    )

    if (!this.started) {
      // Do not sweep in from wherever the camera was constructed.
      this.started = true
      this.camera.position.copy(this.cameraGoal)
      this.cameraTarget.copy(this.lookGoal)
    } else {
      const ease = 1 - Math.exp(-dt / CAMERA_EASE)
      this.camera.position.lerp(this.cameraGoal, ease)
      this.cameraTarget.lerp(this.lookGoal, ease)
    }

    this.camera.lookAt(this.cameraTarget)
  }

  private buildLighting(): void {
    this.scene.add(new THREE.HemisphereLight(0x9fe8ff, 0x04263f, 1.1))

    const key = new THREE.DirectionalLight(0xffffff, 1.4)
    key.position.set(40, 60, 90)
    this.scene.add(key)

    const rim = new THREE.DirectionalLight(0x7fd8ff, 0.7)
    rim.position.set(-60, -20, -40)
    this.scene.add(rim)
  }

  /**
   * The sphere of water.
   *
   * Drawn as its inside surface, so the far wall sits behind play and the near
   * wall never comes between the camera and the players. A faint outer shell on
   * top of that gives the surface something to catch the light.
   */
  private buildPool(): void {
    const inner = new THREE.Mesh(
      new THREE.SphereGeometry(POOL_RADIUS, 64, 48),
      new THREE.MeshStandardMaterial({
        color: COLOURS.water,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0.72,
        roughness: 0.9,
      }),
    )
    this.scene.add(inner)

    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(POOL_RADIUS * 1.004, 48, 32),
      new THREE.MeshPhysicalMaterial({
        color: COLOURS.surface,
        transparent: true,
        opacity: 0.07,
        roughness: 0.15,
        metalness: 0,
        side: THREE.FrontSide,
      }),
    )
    this.scene.add(shell)

    // The waterline where the sphere meets the plane of play, to read its size.
    this.scene.add(
      ring(POOL_RADIUS, 0.35, COLOURS.surface, 0.6),
    )
  }

  private buildMarkings(): void {
    this.scene.add(ring(CENTRE_CIRCLE_RADIUS, 0.22, COLOURS.markings, 0.35))

    const halfway = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.05, POOL_RADIUS * 2),
      new THREE.MeshBasicMaterial({ color: COLOURS.markings, transparent: true, opacity: 0.28 }),
    )
    this.scene.add(halfway)
  }

  /**
   * Goals are hoops you shoot through, standing across the length of the pitch.
   *
   * Shaped as FFX's are: a triangle pointing downwards with generously rounded
   * corners, rather than a plain ring. The netting behind it is gone — at this
   * scale a wireframe hemisphere read as a smudge rather than a net.
   */
  private buildGoal(side: Side): void {
    const hoop = new THREE.Mesh(
      new THREE.TubeGeometry(
        roundedTriangle(GOAL_HALF_HEIGHT * 1.25, GOAL_HALF_HEIGHT * 0.42),
        128,
        0.6,
        12,
        true,
      ),
      new THREE.MeshStandardMaterial({
        color: COLOURS.goal,
        emissive: COLOURS.goal,
        emissiveIntensity: 0.45,
        roughness: 0.4,
      }),
    )
    hoop.position.set(goalLineX(side), 0, 0)
    // Built facing the camera; turn it to face along the length of the pitch.
    hoop.rotation.y = Math.PI / 2
    this.scene.add(hoop)
  }

  private drawPlayer(state: MatchState, player: Player, alpha: number): void {
    const body = this.bodyFor(state, player)
    const at = interpolateToScene({ x: player.prevX, y: player.prevY }, player, alpha)
    body.group.position.set(at.x, at.y, at.z)

    const controlled = player.id === state.controlled
    body.ring.visible = controlled
    body.marker.visible = state.ball.carrier === player.id

    // Stamina shows as the body dimming rather than as another gauge to read,
    // and a beaten defender goes darker still while they are out of the play.
    const fraction = Math.max(0, Math.min(1, player.hp / player.stats.hp))
    const material = body.mesh.material as THREE.MeshStandardMaterial
    material.emissiveIntensity = player.recovery > 0 ? 0.02 : 0.08 + fraction * 0.32
    material.opacity = player.recovery > 0 ? 0.45 : 1
    material.transparent = player.recovery > 0
    if (isExhausted(player)) material.emissive.setHex(COLOURS.danger)

    const labels = statusLabels(player)
    body.status.visible = labels.length > 0
    if (labels.length > 0 && body.statusText !== labels.join(' ')) {
      body.statusText = labels.join(' ')
      paintLabel(body.status, body.statusText, '#c98bff')
    }
  }

  private bodyFor(state: MatchState, player: Player): PlayerBody {
    const existing = this.bodies.get(player.id)
    if (existing) return existing

    const colour = new THREE.Color(state.teams[player.team].def.colours.primary)
    const group = new THREE.Group()

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(PLAYER_RADIUS, 24, 18),
      new THREE.MeshStandardMaterial({
        color: colour,
        emissive: colour,
        emissiveIntensity: 0.3,
        roughness: 0.55,
      }),
    )
    group.add(mesh)

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(PLAYER_RADIUS + 1.2, 0.28, 8, 32),
      new THREE.MeshBasicMaterial({ color: COLOURS.control }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.visible = false
    group.add(ring)

    // A small crown above whoever has the ball, readable from any distance.
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 1.8, 12),
      new THREE.MeshBasicMaterial({ color: COLOURS.ball }),
    )
    marker.position.set(0, PLAYER_RADIUS + 5.2, 0)
    marker.rotation.z = Math.PI
    marker.visible = false
    group.add(marker)

    const name = makeLabel(player.def.name, '#e8f4ff')
    name.position.set(0, PLAYER_RADIUS + 2.6, 0)
    group.add(name)

    const status = makeLabel('', '#c98bff')
    status.position.set(0, PLAYER_RADIUS + 6.4, 0)
    status.visible = false
    group.add(status)

    this.scene.add(group)
    const body: PlayerBody = { group, mesh, ring, marker, status, statusText: '' }
    this.bodies.set(player.id, body)
    return body
  }
}

interface PlayerBody {
  group: THREE.Group
  mesh: THREE.Mesh
  ring: THREE.Mesh
  marker: THREE.Mesh
  status: THREE.Sprite
  statusText: string
}

/** A flat ring lying in the plane of play. */
function ring(radius: number, thickness: number, colour: number, opacity: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(radius, thickness, 8, 96),
    new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity }),
  )
  // A torus is built standing up; lay it down onto the plane of play.
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

/**
 * Text that always faces the camera.
 *
 * Sprites rather than 3D text: names have to stay legible from anywhere in the
 * pool, and a mesh would turn edge-on and disappear.
 */
function makeLabel(text: string, colour: string): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ transparent: true, depthTest: false }),
  )
  sprite.scale.set(14, 3.5, 1)
  paintLabel(sprite, text, colour)
  return sprite
}

function paintLabel(sprite: THREE.Sprite, text: string, colour: string): void {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64

  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.font = '600 34px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillText(text, 128, 34)
    ctx.fillStyle = colour
    ctx.fillText(text, 128, 32)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = sprite.material as THREE.SpriteMaterial
  material.map?.dispose()
  material.map = texture
  material.needsUpdate = true
}

/**
 * The goal that is under threat: the one defended by whichever side does not
 * have the ball. With the ball loose, the user's own attacking end stands in,
 * so the view does not swing about while it is up for grabs.
 */
function threatenedGoalX(state: MatchState): number {
  const carrier = carrierOf(state)
  const defending = carrier ? opponentOf(carrier.team) : opponentOf(USER_TEAM)
  return goalLineX(state.teams[defending].defending)
}

/**
 * A triangle pointing downwards with rounded corners, as a closed curve.
 *
 * Each corner is a quadratic bezier whose control point is the sharp vertex it
 * replaces. That meets both edges smoothly for far less arithmetic than
 * constructing tangent arcs, and at this size the two are indistinguishable.
 */
function roundedTriangle(radius: number, corner: number): THREE.CurvePath<THREE.Vector3> {
  // Point down: one vertex at the bottom, two across the top, as FFX has it.
  const vertices = [270, 30, 150].map((degrees) => {
    const angle = (degrees * Math.PI) / 180
    return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
  })

  const path = new THREE.CurvePath<THREE.Vector3>()

  for (let i = 0; i < vertices.length; i++) {
    const previous = vertices[(i + 2) % 3]!
    const current = vertices[i]!
    const next = vertices[(i + 1) % 3]!

    const from = current.clone().lerp(previous, corner / current.distanceTo(previous))
    const to = current.clone().lerp(next, corner / current.distanceTo(next))
    const nextCorner = next.clone().lerp(current, corner / next.distanceTo(current))

    path.add(new THREE.QuadraticBezierCurve3(from, current, to))
    path.add(new THREE.LineCurve3(to, nextCorner))
  }

  return path
}
