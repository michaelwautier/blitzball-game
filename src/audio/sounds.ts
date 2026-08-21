import type { MatchSound } from './events'

/**
 * The match, made audible — synthesised rather than sampled.
 *
 * Every sound here is built from oscillators and filtered noise at the moment it
 * plays. That keeps the repository free of binary assets and licences, and it
 * puts each sound where every other tunable in this project lives: in code, as
 * named numbers with a note on why they are what they are.
 *
 * Everything runs through one low-pass, because everything happens underwater.
 * That single filter is what stops a set of dry synthesised blips sounding like
 * a menu and makes them sound like a pool.
 *
 * Silent until the first gesture: browsers refuse to start audio before one, and
 * a game that demanded sound before it would run would be worse than a quiet
 * one.
 */

/** Where the water starts swallowing things, in hertz. */
const WATER_CUTOFF = 2200

/** Master level. Low: these fire constantly during a match. */
const MASTER_GAIN = 0.5

/** Sounds no louder than this fraction of master, each tuned against the rest. */
const LEVELS: Record<MatchSound, number> = {
  pass: 0.35,
  shot: 0.7,
  catch: 0.5,
  goal: 1,
  tackle: 0.8,
  breakthrough: 0.55,
  encounter: 0.4,
  whistle: 0.9,
}

type Context = AudioContext & { destination: AudioNode }

export class Sounds {
  private context: Context | null = null
  private master: GainNode | null = null
  private muted = false

  /** Whether sound is currently off. */
  get isMuted(): boolean {
    return this.muted
  }

  /** Turn sound on or off, and report where it landed. */
  toggle(): boolean {
    this.muted = !this.muted
    if (this.master) this.master.gain.value = this.muted ? 0 : MASTER_GAIN
    return this.muted
  }

  /**
   * Start the audio hardware, on a gesture.
   *
   * Safe to call on every keypress: it opens the context once and resumes it if
   * the browser has since suspended it, which happens whenever a tab is left.
   */
  wake(): void {
    if (!this.context) this.open()
    if (this.context?.state === 'suspended') void this.context.resume()
  }

  play(sound: MatchSound): void {
    if (this.muted) return
    this.wake()
    const context = this.context
    const master = this.master
    if (!context || !master) return

    const at = context.currentTime
    const level = LEVELS[sound]

    switch (sound) {
      // A ball leaving a hand: filtered noise sweeping upward, brief.
      case 'pass':
        return this.swish(at, 0.18, 400, 1400, level)

      // The same gesture with weight behind it — a wider sweep, and a low thump
      // underneath so it lands in the chest rather than the ear.
      case 'shot':
        this.swish(at, 0.26, 300, 2200, level)
        return this.thump(at, 0.22, 120, 55, level * 0.8)

      // Gloved, and dead: no ring, no sweep, just a stop.
      case 'catch':
        return this.swish(at, 0.12, 900, 320, level, 'lowpass')

      // Bodies meeting. Low and short, with grit on top.
      case 'tackle':
        this.thump(at, 0.18, 170, 60, level)
        return this.swish(at, 0.1, 1200, 400, level * 0.45, 'lowpass')

      // Getting out the other side: a rising note, because it is a small win.
      case 'breakthrough':
        return this.sweepTone(at, 0.26, 240, 680, level)

      // Two low blips, the way a menu opening asks for attention without
      // claiming to be an event in itself.
      case 'encounter':
        this.sweepTone(at, 0.06, 300, 300, level)
        return this.sweepTone(at + 0.09, 0.06, 400, 400, level)

      // The one sound allowed to be big.
      case 'goal':
        return this.fanfare(at, level)

      case 'whistle':
        return this.whistle(at, level)
    }
  }

  private open(): void {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return

    const context = new Ctor() as Context
    const water = context.createBiquadFilter()
    water.type = 'lowpass'
    water.frequency.value = WATER_CUTOFF

    const master = context.createGain()
    master.gain.value = this.muted ? 0 : MASTER_GAIN

    water.connect(master)
    master.connect(context.destination)

    this.context = context
    this.master = master
    // Two ways in. Almost everything goes through the water; the whistle does
    // not, because it is the one sound made above it.
    this.into = water
    this.dry = master
  }

  private into: AudioNode | null = null
  private dry: AudioNode | null = null

  /** Filtered noise sweeping between two frequencies: every throw and impact. */
  private swish(
    at: number,
    seconds: number,
    from: number,
    to: number,
    level: number,
    type: BiquadFilterType = 'bandpass',
    bus: AudioNode | null = this.into,
  ): void {
    const context = this.context
    if (!context || !bus) return

    const source = context.createBufferSource()
    source.buffer = this.noise(seconds)

    const filter = context.createBiquadFilter()
    filter.type = type
    filter.Q.value = type === 'bandpass' ? 1.4 : 0.9
    filter.frequency.setValueAtTime(from, at)
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + seconds)

    const gain = context.createGain()
    envelope(gain, at, seconds, level)

    source.connect(filter).connect(gain).connect(bus)
    source.start(at)
    source.stop(at + seconds)
  }

  /** A falling sine: the body of any impact. */
  private thump(at: number, seconds: number, from: number, to: number, level: number): void {
    this.sweepTone(at, seconds, from, to, level, 'sine')
  }

  private sweepTone(
    at: number,
    seconds: number,
    from: number,
    to: number,
    level: number,
    type: OscillatorType = 'triangle',
    bus: AudioNode | null = this.into,
  ): void {
    const context = this.context
    if (!context || !bus) return

    const osc = context.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(from, at)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + seconds)

    const gain = context.createGain()
    envelope(gain, at, seconds, level)

    osc.connect(gain).connect(bus)
    osc.start(at)
    osc.stop(at + seconds)
  }

  /**
   * A goal: a major chord over a swell of noise.
   *
   * The noise is the crowd, near enough. Real crowd samples are the one thing
   * synthesis cannot fake, but filtered noise rising and falling under a chord
   * reads as a stadium reacting, which is the part that matters.
   */
  private fanfare(at: number, level: number): void {
    const root = 330
    for (const [step, delay] of [[1, 0], [1.26, 0.06], [1.5, 0.12], [2, 0.18]] as const) {
      this.sweepTone(at + delay, 0.85 - delay, root * step, root * step, level * 0.4)
    }
    this.swish(at, 1.1, 300, 900, level * 0.45, 'lowpass')
  }

  /**
   * The referee, and the only thing here that does not go through the water.
   *
   * It was inaudible, for two reasons that compounded. It sat at 1900–2100Hz
   * against a low-pass cutting at 2200 — right on the knee, where a square wave
   * loses every harmonic that makes it shrill and what survives is a quiet sine
   * at the corner frequency. And a whistle *should* be the exception: it is blown
   * above the surface by someone who wants to be heard through it, which is the
   * whole reason a real one works at a pool.
   *
   * So it takes the dry bus, sits lower where it has room to be loud, and gets a
   * breath of noise over the top the way a real whistle has air in it.
   */
  private whistle(at: number, level: number): void {
    const blast = (start: number, seconds: number, from: number, to: number) => {
      this.sweepTone(start, seconds, from, to, level, 'square', this.dry)
      // The pea rattling, near enough.
      this.swish(start, seconds, 1500, 1900, level * 0.3, 'bandpass', this.dry)
    }

    blast(at, 0.2, 1250, 1400)
    blast(at + 0.26, 0.34, 1400, 1250)
  }

  /** White noise, made once per call and short enough not to be worth caching. */
  private noise(seconds: number): AudioBuffer {
    const context = this.context!
    const frames = Math.max(1, Math.floor(context.sampleRate * seconds))
    const buffer = context.createBuffer(1, frames, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1
    return buffer
  }
}

/**
 * Fade in fast, fade out over the whole tail.
 *
 * The quick attack is what makes an impact sound like one, and never starting or
 * ending at exactly zero avoids the click a hard edge produces.
 */
function envelope(gain: GainNode, at: number, seconds: number, level: number): void {
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), at + Math.min(0.012, seconds / 3))
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds)
}
