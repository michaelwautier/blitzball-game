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
import { edgeMarker, type EdgeMarker } from './off-screen'
import { statusLabels } from '../core/match/status'
import { isExhausted } from '../core/match/stats'
import { carrierOf, opponentOf, playerById } from '../core/match/queries'
import { USER_TEAM, type MatchState, type Player } from '../core/match/state'
import { interpolateToScene, type Vec3 } from './projection'

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
 * The broadcast camera, all as fractions of the pool.
 *
 * Low and back, looking across the water rather than down onto it — the angle a
 * touchline camera takes, which is what puts the far wall of the sphere on the
 * horizon instead of filling the frame with pitch.
 *
 * Being fractions keeps the *pitch* framed the same through a resize, but not
 * the *players*: bodies are a fixed size on purpose, so scaling the stand-off
 * with the pool walks the camera away from them. Enlarging the pool would
 * otherwise have shrunk everyone by the same third, which is why a closer
 * camera and a bigger pool were always one change rather than two.
 *
 * Cut by far more than the resize, so the camera now sits closer to the player
 * in absolute terms than it ever did at the old size: 27 and 51 units, against
 * 33 and 64 before. This is the pair to nudge for a tighter or wider shot, and
 * nothing else reads them.
 */
const CAMERA_HEIGHT = POOL_RADIUS * 0.18
const CAMERA_BACK = POOL_RADIUS * 0.34

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


/** Seconds for the camera to cover most of the distance to where it wants to be. */
const CAMERA_EASE = 0.5


/**
 * How far the camera may sit from the middle of the pool.
 *
 * Generous enough that it can always be a full stand-off behind whoever it is
 * following, which near the far edge means outside the sphere looking in. That
 * is fine: the water renders from either side, and the whole pool simply comes
 * into view.
 *
 * The camera used to trail in depth by a *damped* fraction, which drifts
 * pleasantly in the middle of the pool and fails at its edge — the camera ends
 * up level with the player, who is then not on screen at all. The obvious
 * repair, retreating towards the middle, is worse than the bug: it swings the
 * camera round to the other side of the player, which flips the world against
 * the screen and inverts the controls mid-swim.
 *
 * So the camera trails by the same stand-off, in the same direction, everywhere
 * in the pool. Controls that mean one thing in the middle and the opposite at
 * the edge are unplayable, and no framing is worth that.
 */
const CAMERA_CONFINE = 1.65


/**
 * How far the camera closes in while an encounter is being decided.
 *
 * A fraction of the usual stand-off, not a fixed distance, so it scales with the
 * pool like everything else here. Modest on purpose: the decision is read from
 * the menu and the stat panel, and the camera's job is to say *who* the menu is
 * talking about by bringing the confrontation closer, not to swap to a different
 * shot and lose the run of play.
 */
const ENCOUNTER_CLOSE_IN = 0.72

/** Markings draw after the water, so the pitch is never lost inside its own pool. */
const MARKINGS_ORDER = 1

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

  private marker: EdgeMarker | null = null

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

  /**
   * `focusId` overrides who the camera follows — used while a pass target is
   * being chosen, so the player deciding can see where the ball would go.
   */
  draw(state: MatchState, alpha: number, dt = 1 / 60, focusId: string | null = null): void {
    for (const player of state.players) this.drawPlayer(state, player, alpha)

    const ball = interpolateToScene(
      { x: state.ball.prevX, y: state.ball.prevY },
      state.ball,
      alpha,
    )
    this.ball.position.set(ball.x, ball.y, ball.z)

    this.followPlayer(state, dt, focusId, alpha)
    this.renderer.render(this.scene, this.camera)
    this.marker = this.markBall()
  }

  /**
   * Where the ball is, for anything drawn on top of the scene — or null while it
   * is in view and needs no help.
   *
   * Read after `draw`, since it is the camera's own answer for the frame that
   * was just rendered rather than a separate guess at where things ended up.
   */
  ballMarker(): EdgeMarker | null {
    return this.marker
  }

  private markBall(): EdgeMarker | null {
    // Camera space first, purely to ask which side of the lens it is on: a
    // projection alone cannot tell "far in front" from "behind", having mirrored
    // the second through the origin.
    const seen = this.ball.position.clone().applyMatrix4(this.camera.matrixWorldInverse)
    const projected = this.ball.position.clone().project(this.camera)
    return edgeMarker(projected.x, projected.y, seen.z > 0)
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
  private followPlayer(
    state: MatchState,
    dt: number,
    focusId: string | null,
    alpha: number,
  ): void {
    const focus = focusPoint(state, focusId, alpha)
    if (!focus) return
    const towards = Math.sign(threatenedGoalX(state) - focus.x) || 1

    // Closer while a decision is open, so the defenders the menu names are
    // legible — and held there through the challenge it commits to, which is
    // the part actually worth watching. Pulling out the moment the menu closes
    // would swing the camera away exactly as the tackles start landing.
    // Eased into like every other camera move, by the lerp below.
    const decided = state.phase.kind === 'encounter' || state.phase.kind === 'challenge'
    const close = decided ? ENCOUNTER_CLOSE_IN : 1
    cameraGoalFor(this.cameraGoal, focus, towards, close)

    // Aim a little beyond play, so the pitch sits in the middle of the frame
    // rather than riding high with empty water in the foreground.
    //
    // Anchored on the focus rather than damped towards the middle like the
    // camera's own position. Damping both meant that at the far edge of the pool
    // the camera stood correctly behind the player and then looked *past* them,
    // back towards the centre — so the player it was following was behind the
    // lens. Identical in the middle of the pool, where the damped and undamped
    // depths agree.
    this.lookGoal.set(focus.x + towards * CAMERA_LEAD, 0, focus.z - POOL_RADIUS * 0.1)
    if (!this.started) {
      // Do not sweep in from wherever the camera was constructed.
      this.started = true
      this.camera.position.copy(this.cameraGoal)
      this.cameraTarget.copy(this.lookGoal)
    } else {
      // One ease for everything, including menu selections. A faster one was
      // tried for those — a preview took a second and a half to arrive, which
      // looked like lag — but the sweep across the pool turns out to be worth
      // more than the promptness, so it stays.
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
        // The pool, its markings and its surface are all centred on the origin,
        // so three.js has no meaningful distance to sort them by and the order
        // is effectively arbitrary. Writing depth from the water meant it could
        // cull the markings behind it depending on which happened to draw first.
        depthWrite: false,
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
        depthWrite: false,
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
    halfway.renderOrder = MARKINGS_ORDER
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

    this.sizeLabels(body)

    const labels = statusLabels(player)
    body.status.visible = labels.length > 0
    if (labels.length > 0 && body.statusText !== labels.join(' ')) {
      body.statusText = labels.join(' ')
      paintLabel(body.status, body.statusText, '#c98bff')
    }
  }

  /**
   * Hold names at a constant size on screen, whatever the distance.
   *
   * A sprite has a size in the world, so it grows as the camera nears it — and
   * a player who swims close to the camera had their name fill a quarter of the
   * frame. Scaling by distance undoes the perspective divide, which is what the
   * labels were always meant to do: a name is a caption, not part of the scene.
   *
   * Clamped at both ends so a name never becomes unreadably small far away, and
   * never overpowers the play close up.
   */
  private sizeLabels(body: PlayerBody): void {
    const distance = this.camera.position.distanceTo(body.group.position)
    const scale = clamp(distance / LABEL_REFERENCE_DISTANCE, LABEL_MIN_SCALE, LABEL_MAX_SCALE)

    body.name.scale.set(LABEL_WIDTH * scale, LABEL_HEIGHT * scale, 1)
    body.status.scale.set(LABEL_WIDTH * scale, LABEL_HEIGHT * scale, 1)
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
    const body: PlayerBody = { group, mesh, ring, marker, name, status, statusText: '' }
    this.bodies.set(player.id, body)
    return body
  }
}

interface PlayerBody {
  group: THREE.Group
  mesh: THREE.Mesh
  ring: THREE.Mesh
  marker: THREE.Mesh
  name: THREE.Sprite
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
  mesh.renderOrder = MARKINGS_ORDER
  return mesh
}

/**
 * Text that always faces the camera.
 *
 * Sprites rather than 3D text: names have to stay legible from anywhere in the
 * pool, and a mesh would turn edge-on and disappear.
 */
/**
 * A label's size in world units at `LABEL_REFERENCE_DISTANCE` from the camera.
 *
 * Sized so that, scaled proportionally, a name comes out around a fifth the
 * height of a body on screen — a caption rather than a banner.
 */
const LABEL_WIDTH = 9
const LABEL_HEIGHT = 2.25

/** The distance labels are sized for; nearer or further, they are scaled to match. */
const LABEL_REFERENCE_DISTANCE = POOL_RADIUS * 0.62
/**
 * The clamps only catch the extremes; almost every label sits between them and
 * is therefore a constant size on screen.
 *
 * The floor applies to players *near* the camera, whose labels must be small in
 * the world to come out ordinary on screen — so it is set low enough to stay out
 * of the way. A generous floor is precisely what leaves a nearby name filling
 * the frame, which is the bug this replaced. The ceiling applies to the far
 * side of the pool and only stops a label growing absurdly in world space.
 */
const LABEL_MIN_SCALE = 0.04
const LABEL_MAX_SCALE = 3.4

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

function makeLabel(text: string, colour: string): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ transparent: true, depthTest: false }),
  )
  sprite.scale.set(LABEL_WIDTH, LABEL_HEIGHT, 1)
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

/**
 * What the camera is watching, in order of what matters most at that moment.
 *
 * A teammate being considered for a pass, because that is a decision about
 * somewhere else on the pitch. Then the ball, if it is in the air — a throw is
 * the event, and staying on the player who let go of it means watching the
 * least interesting thing in the pool. Otherwise whoever the user is steering.
 */
export function focusPoint(state: MatchState, focusId: string | null, alpha: number): Vec3 | null {
  const previewed = focusId ? playerById(state, focusId) : undefined
  if (previewed) return interpolateToScene(previewed, previewed, 1)

  if (state.phase.kind === 'flight') {
    return interpolateToScene(
      { x: state.ball.prevX, y: state.ball.prevY },
      state.ball,
      alpha,
    )
  }

  const steered = playerById(state, state.controlled) ?? state.players[0]
  return steered ? interpolateToScene(steered, steered, 1) : null
}

/**
 * Where the camera wants to be, given what it is following.
 *
 * The same stand-off, in the same direction, from anywhere in the pool — which
 * is the property that keeps the controls meaning one thing. Exported so that
 * can be asserted rather than hoped for.
 */
export function cameraGoalFor(
  into: THREE.Vector3,
  focus: { x: number; z: number },
  towards: number,
  close: number,
): THREE.Vector3 {
  into.set(
    focus.x - towards * CAMERA_TRAIL * close,
    CAMERA_HEIGHT * close,
    focus.z + CAMERA_BACK * close,
  )
  confineToPool(into)
  return into
}

/**
 * Stop the camera wandering off altogether.
 *
 * Projected straight back along its own line from the centre, so the direction
 * it was looking from is preserved and it simply comes in closer rather than
 * swinging round to somewhere else. Note the limit is well outside the water —
 * see `CAMERA_CONFINE` for why the camera is allowed out of it.
 */
export function confineToPool(position: THREE.Vector3): void {
  const limit = POOL_RADIUS * CAMERA_CONFINE
  const distance = position.length()
  if (distance <= limit || distance === 0) return
  position.multiplyScalar(limit / distance)
}
