import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { cameraGoalFor, confineToPool, focusPoint } from './scene-renderer'
import { POOL_RADIUS } from '../core/pitch'
import { createMatch } from '../core/match/state'
import { giveBallTo } from '../core/match/possession'
import { startPass } from '../core/match/flight'
import { BESAID_AUROCHS, LUCA_GOERS } from '../data/teams'
import type { MatchState, Player } from '../core/match/types'

/**
 * The camera's one non-negotiable property is that it behaves the same way
 * everywhere in the pool. A camera that trails from behind in the middle and
 * from in front at the edge flips the world against the screen, and the
 * controls invert under the player's hands mid-swim — which is far worse than
 * any framing problem it might be solving.
 *
 * Points all over the pool, including hard against every wall.
 */
const acrossThePool = () => {
  const spots: { x: number; z: number }[] = []
  for (const r of [0, 0.4, 0.8, 0.97]) {
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      spots.push({ x: Math.cos(angle) * POOL_RADIUS * r, z: Math.sin(angle) * POOL_RADIUS * r })
    }
  }
  return spots
}

const goal = (focus: { x: number; z: number }, towards = 1, close = 1) =>
  cameraGoalFor(new THREE.Vector3(), focus, towards, close)

describe('where the camera puts itself', () => {
  it('is always behind the player, never level with or ahead of them', () => {
    for (const focus of acrossThePool()) {
      const camera = goal(focus)
      expect(camera.z, `level with a player at ${focus.x.toFixed(0)},${focus.z.toFixed(0)}`)
        .toBeGreaterThan(focus.z)
    }
  })

  it('trails by the same distance wherever they are', () => {
    const gaps = acrossThePool().map((focus) => {
      const camera = goal(focus)
      return Math.hypot(camera.x - focus.x, camera.z - focus.z)
    })

    // The spread across the whole pool is a rounding error, not a difference.
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.5)
  })

  it('never flips which side of the player it sits on', () => {
    // The failure this replaces: retreating towards the middle put the camera
    // on the far side of a player at the edge, inverting the controls.
    for (const focus of acrossThePool()) {
      expect(goal(focus).z - focus.z, `flipped at ${focus.z.toFixed(0)}`).toBeGreaterThan(0)
    }
  })

  it('comes in closer while a decision is open, without changing sides', () => {
    for (const focus of acrossThePool()) {
      const open = goal(focus, 1, 0.72)
      const normal = goal(focus)

      expect(open.z - focus.z).toBeGreaterThan(0)
      expect(open.z - focus.z).toBeLessThan(normal.z - focus.z)
    }
  })

  it('is allowed out of the water, since the alternative is losing the player', () => {
    // A player at the far edge cannot be viewed from behind by a camera that is
    // itself inside the sphere. The water renders from either side; the camera
    // being out of position does not.
    const edge = { x: 0, z: POOL_RADIUS * 0.97 }
    expect(goal(edge).length()).toBeGreaterThan(POOL_RADIUS)
  })
})

/**
 * The confine used to keep the camera strictly inside the water, on the grounds
 * that outside it you are looking at a sphere in a black void. That turned out
 * not to be true — checked on screen, the pool renders perfectly well from just
 * outside — and insisting on it is what made a player at the far edge
 * unviewable. It now only stops the camera wandering off altogether.
 */
describe('confining the camera', () => {
  it('leaves a position inside the limit alone', () => {
    const inside = new THREE.Vector3(10, 30, 10)
    const before = inside.clone()
    confineToPool(inside)
    expect(inside).toEqual(before)
  })

  it('reels in something absurdly far out', () => {
    const outside = new THREE.Vector3(POOL_RADIUS * 40, 0, 0)
    confineToPool(outside)
    expect(outside.length()).toBeLessThan(POOL_RADIUS * 2)
  })

  it('keeps the direction it was looking from', () => {
    const outside = new THREE.Vector3(POOL_RADIUS * 9, 40, POOL_RADIUS * 8)
    const heading = outside.clone().normalize()
    confineToPool(outside)
    // Projected straight back along its own line, so it comes in closer rather
    // than swinging round to somewhere else entirely.
    expect(outside.clone().normalize().distanceTo(heading)).toBeLessThan(1e-6)
  })

  it('handles the centre without dividing by zero', () => {
    const centre = new THREE.Vector3(0, 0, 0)
    confineToPool(centre)
    expect(centre.length()).toBe(0)
  })
})


describe('what the camera chooses to watch', () => {
  const find = (state: MatchState, id: string): Player => {
    const player = state.players.find((p) => p.id === id)
    if (!player) throw new Error(`no player ${id}`)
    return player
  }

  const playing = () => {
    const state = createMatch(BESAID_AUROCHS, LUCA_GOERS, 'focus')
    const carrier = find(state, 'home:wakka')
    carrier.x = -60
    carrier.y = 0
    giveBallTo(state, carrier)
    state.controlled = carrier.id
    state.phase = { kind: 'play' }
    return { state, carrier }
  }

  it('watches whoever the user is steering, normally', () => {
    const { state, carrier } = playing()
    const focus = focusPoint(state, null, 1)!
    expect(focus.x).toBeCloseTo(carrier.x, 3)
  })

  it('watches the ball while it is in the air, not the player who threw it', () => {
    // Staying on the passer means watching the least interesting thing in the
    // pool for the second and a half the throw takes.
    const { state, carrier } = playing()
    const receiver = find(state, 'home:tidus')
    receiver.x = 60
    receiver.y = 30

    state.ball.carrier = null
    state.ball.x = 20
    state.ball.y = 10
    state.ball.prevX = 20
    state.ball.prevY = 10
    state.phase = { kind: 'flight', flight: startPass(carrier, receiver, 60) }

    const focus = focusPoint(state, null, 1)!
    expect(focus.x).toBeCloseTo(20, 3)
    expect(focus.z).toBeCloseTo(10, 3)
    expect(focus.x).not.toBeCloseTo(carrier.x, 3)
  })

  it('interpolates the ball, so following it is smooth rather than stepped', () => {
    const { state, carrier } = playing()
    state.ball.carrier = null
    state.ball.prevX = 0
    state.ball.prevY = 0
    state.ball.x = 10
    state.ball.y = 20
    state.phase = { kind: 'flight', flight: startPass(carrier, carrier, 60) }

    expect(focusPoint(state, null, 0.5)!.x).toBeCloseTo(5, 3)
    expect(focusPoint(state, null, 0.5)!.z).toBeCloseTo(10, 3)
  })

  it('watches a previewed teammate above all else', () => {
    // Even mid-flight: if a menu is asking about somewhere else, that wins.
    const { state, carrier } = playing()
    const mate = find(state, 'home:datto')
    mate.x = 40
    mate.y = -20
    state.phase = { kind: 'flight', flight: startPass(carrier, mate, 60) }

    const focus = focusPoint(state, mate.id, 1)!
    expect(focus.x).toBeCloseTo(mate.x, 3)
    expect(focus.z).toBeCloseTo(mate.y, 3)
  })

  it('falls back to the steered player when a preview names nobody real', () => {
    const { state, carrier } = playing()
    expect(focusPoint(state, 'nobody', 1)!.x).toBeCloseTo(carrier.x, 3)
  })
})
