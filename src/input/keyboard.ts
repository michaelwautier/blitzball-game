import type { MatchInput } from '../core/match/state'

const DIRECTIONS: Readonly<Record<string, { x: number; y: number }>> = {
  arrowup: { x: 0, y: -1 },
  w: { x: 0, y: -1 },
  arrowdown: { x: 0, y: 1 },
  s: { x: 0, y: 1 },
  arrowleft: { x: -1, y: 0 },
  a: { x: -1, y: 0 },
  arrowright: { x: 1, y: 0 },
  d: { x: 1, y: 0 },
}

/**
 * Turns held keys into a swim direction.
 *
 * The simulation never sees the DOM: this is the only place key events exist,
 * and it hands `stepMatch` a plain direction vector.
 */
export class KeyboardInput {
  private readonly held = new Set<string>()
  private readonly onKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase()
    if (key in DIRECTIONS) {
      this.held.add(key)
      event.preventDefault()
    }
  }
  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.held.delete(event.key.toLowerCase())
  }
  // A tab switch swallows the keyup, which would otherwise leave a key stuck on.
  private readonly onBlur = () => this.held.clear()

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown)
    target.addEventListener('keyup', this.onKeyUp)
    target.addEventListener('blur', this.onBlur)
  }

  read(): MatchInput {
    let x = 0
    let y = 0
    for (const key of this.held) {
      const direction = DIRECTIONS[key]
      if (!direction) continue
      x += direction.x
      y += direction.y
    }
    return { move: { x, y } }
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown)
    this.target.removeEventListener('keyup', this.onKeyUp)
    this.target.removeEventListener('blur', this.onBlur)
  }
}
