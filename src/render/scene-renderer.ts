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
import type { MatchState, Player } from '../core/match/state'
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
 * How far the camera sits back from the plane of play.
 *
 * Far enough that the whole sphere fits the frame with room around it: at the
 * default field of view the pool subtends most of the height, and any closer
 * clips the bottom of it.
 */
const CAMERA_DISTANCE = 178

/** How much the camera drifts towards the ball, as a fraction of its offset. */
const CAMERA_FOLLOW = 0.22

/** Seconds for the camera to cover most of the distance to where it wants to be. */
const CAMERA_EASE = 0.9

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
  private readonly cameraGoal = new THREE.Vector3(0, 0, CAMERA_DISTANCE)

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setClearColor(COLOURS.background, 1)

    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 800)
    this.camera.position.set(0, 0, CAMERA_DISTANCE)

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
    // Pull back on a narrow window so the whole pool stays in frame.
    this.camera.fov = this.camera.aspect < 1.2 ? 56 : 42
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

    this.followBall(ball, dt)
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.renderer.dispose()
  }

  /**
   * Drift the camera towards the ball rather than tracking it exactly.
   *
   * A camera locked to the ball makes the pool itself appear to swing about,
   * which is disorienting and hides where play actually is. Following a fraction
   * of the way keeps the sphere steady and still leads the eye.
   */
  private followBall(ball: { x: number; y: number }, dt: number): void {
    this.cameraGoal.set(ball.x * CAMERA_FOLLOW, ball.y * CAMERA_FOLLOW, CAMERA_DISTANCE)
    const ease = 1 - Math.exp(-dt / (CAMERA_EASE / 3))
    this.camera.position.lerp(this.cameraGoal, ease)

    this.cameraTarget.lerp(new THREE.Vector3(ball.x * 0.35, ball.y * 0.35, 0), ease)
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
      new THREE.BoxGeometry(0.25, POOL_RADIUS * 2, 0.05),
      new THREE.MeshBasicMaterial({ color: COLOURS.markings, transparent: true, opacity: 0.28 }),
    )
    this.scene.add(halfway)
  }

  /** Goals are rings standing in the plane of play, as they are in FFX. */
  private buildGoal(side: Side): void {
    const x = goalLineX(side)

    const hoop = new THREE.Mesh(
      new THREE.TorusGeometry(GOAL_HALF_HEIGHT, 0.55, 12, 40),
      new THREE.MeshStandardMaterial({
        color: COLOURS.goal,
        emissive: COLOURS.goal,
        emissiveIntensity: 0.45,
        roughness: 0.4,
      }),
    )
    hoop.position.set(x, 0, 0)
    this.scene.add(hoop)

    const net = new THREE.Mesh(
      new THREE.SphereGeometry(GOAL_HALF_HEIGHT, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: COLOURS.goal,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        wireframe: true,
      }),
    )
    net.position.set(x, 0, 0)
    // Open end towards the pitch, so the mouth faces play.
    net.rotation.z = side === 'left' ? Math.PI / 2 : -Math.PI / 2
    this.scene.add(net)
  }

  private drawPlayer(state: MatchState, player: Player, alpha: number): void {
    const body = this.bodyFor(state, player)
    const at = interpolateToScene({ x: player.prevX, y: player.prevY }, player, alpha)
    body.group.position.set(at.x, at.y, at.z)

    const controlled = player.id === state.controlled
    body.ring.visible = controlled
    body.marker.visible = state.ball.carrier === player.id

    // Stamina shows as the body dimming rather than as another gauge to read.
    const fraction = Math.max(0, Math.min(1, player.hp / player.stats.hp))
    const material = body.mesh.material as THREE.MeshStandardMaterial
    material.emissiveIntensity = 0.08 + fraction * 0.32
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
      new THREE.TorusGeometry(PLAYER_RADIUS + 1.1, 0.22, 8, 32),
      new THREE.MeshBasicMaterial({ color: COLOURS.control }),
    )
    ring.visible = false
    group.add(ring)

    // A small crown above whoever has the ball, readable from any distance.
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 1.8, 12),
      new THREE.MeshBasicMaterial({ color: COLOURS.ball }),
    )
    marker.position.set(0, PLAYER_RADIUS + 2.2, 0)
    marker.rotation.z = Math.PI
    marker.visible = false
    group.add(marker)

    const name = makeLabel(player.def.name, '#e8f4ff')
    name.position.set(0, -PLAYER_RADIUS - 2.4, 0)
    group.add(name)

    const status = makeLabel('', '#c98bff')
    status.position.set(0, PLAYER_RADIUS + 4.4, 0)
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
  return new THREE.Mesh(
    new THREE.TorusGeometry(radius, thickness, 8, 96),
    new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity }),
  )
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
