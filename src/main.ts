import { createLoop, TICK_SECONDS } from './core/loop'
import {
  announce,
  cancelActionMenu,
  createMatch,
  requestActionMenu,
  requestChallenge,
  stepMatch,
  submitDefence,
  submitEncounterAction,
  switchControlled,
  type MatchState,
} from './core/match/state'
import { USER_TEAM } from './core/match/types'
import {
  createSeason,
  fixtureSeed,
  nextUserFixture,
  recordResult,
  simulateRound,
  type Season,
} from './core/league/season'
import { deserialise, localStorageSlot, serialise } from './core/league/save'
import { Squad } from './core/progression/squad'
import { TEAMS, findTeam } from './data/teams'
import { KeyboardInput } from './input/keyboard'
import { Renderer } from './render/renderer'
import { SceneRenderer } from './render/scene-renderer'
import { DebugOverlay } from './ui/debug-overlay'
import { EncounterMenu } from './ui/encounter-menu'
import { LeagueScreen } from './ui/league-screen'
import { MatchSummary } from './ui/match-summary'
import { Scoreboard } from './ui/scoreboard'
import { StatPanel } from './ui/stat-panel'
import { BallMarker } from './ui/ball-marker'
import { Sounds } from './audio/sounds'
import { snapshot, soundsBetween, type AudioSnapshot } from './audio/events'
import type { TeamDef } from './data/types'

const element = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`Missing ${selector}`)
  return found
}

/** The side the user manages. The Aurochs, as in the story. */
const MY_TEAM = 'aurochs'

const scene = new SceneRenderer(element<HTMLCanvasElement>('#game'))
// The same top-down renderer as before, now shrunk into the corner.
const radar = new Renderer(element<HTMLCanvasElement>('#radar'), { compact: true })
const scoreboard = new Scoreboard(element('#scoreboard'), element('#banner'))
const overlay = new DebugOverlay(element('#debug'))
const statPanel = new StatPanel(element('#stats'))
const ballMarker = new BallMarker(element('#ball-marker'))
const sounds = new Sounds()
/** What the match sounded like last frame, to hear the difference this one. */
let heard: AudioSnapshot | null = null
const input = new KeyboardInput()
const slot = localStorageSlot()

const restored = deserialise(slot.read())
let season: Season =
  restored?.season ??
  createSeason(
    TEAMS.map((team) => team.id),
    MY_TEAM,
    `blitzball-${Date.now()}`,
  )
const squad = new Squad(restored?.careers)

/**
 * The match being played, if any.
 *
 * Null while the league screen is up. The loop skips stepping and drawing
 * entirely rather than running a match nobody is looking at.
 */
let state: MatchState | null = null
/** The two sides of the current match, as the engine sees them. */
let sides: Record<'home' | 'away', TeamDef> | null = null
/** Computed once when the match ends, so re-rendering cannot bank it twice. */
let progress: ReturnType<Squad['applyMatch']> | null = null

const league = new LeagueScreen(element('#league'), () => startNextMatch())
const menu = new EncounterMenu(element('#encounter'), {
  onAction: (action) => (state ? submitEncounterAction(state, action) : false),
  onDefend: (techniqueId) => (state ? submitDefence(state, techniqueId) : false),
  onCancel: () => (state ? cancelActionMenu(state) : false),
})
const summary = new MatchSummary(
  element('#summary'),
  () => returnToLeague(),
  () => season.userTeamId,
)

/**
 * Play the user's next fixture.
 *
 * The user's side always takes the engine's `home` slot, whichever end of the
 * fixture they are really at: `USER_TEAM` is what tells the engine which side a
 * person is steering, and the two ends of the pool are worth the same — the
 * mirror-fixture tests exist to keep them that way. The fixture's own
 * orientation is restored when the result is recorded.
 */
function startNextMatch(): void {
  const fixture = nextUserFixture(season)
  if (!fixture) return

  const mine = findTeam(season.userTeamId)
  const theirs = findTeam(fixture.home === season.userTeamId ? fixture.away : fixture.home)

  sides = { home: mine, away: theirs }
  state = createMatch(mine, theirs, fixtureSeed(season, fixture), squad.lookupFor(sides))
  progress = null
  // A new match, so nothing carries over from the last one: the first frame has
  // no previous frame to be compared against.
  heard = null

  league.hide()
  showMatch(true)
  // Kick-off. There is no phase change to read this from — a match simply
  // begins in play — so it is the one sound the presentation asks for directly.
  sounds.play('whistle')
}

/**
 * Bank the finished match and hand the round back to the rest of the league.
 *
 * Recorded in the fixture's own orientation, not the engine's, so an away win
 * is an away win in the table.
 */
function finishMatch(): void {
  if (!state) return

  const fixture = nextUserFixture(season)
  if (fixture) {
    const playedAtHome = fixture.home === season.userTeamId
    const mine = state.teams.home.score
    const theirs = state.teams.away.score
    recordResult(
      season,
      fixture,
      playedAtHome ? mine : theirs,
      playedAtHome ? theirs : mine,
    )
    // The rest of the round is played by the same engine, at the same levels,
    // and everyone in it keeps what they earn.
    simulateRound(season, fixture.round, squad)
  }

  save()
}

function returnToLeague(): void {
  state = null
  sides = null
  progress = null
  showMatch(false)
  league.show(season)
}

/** Show or hide everything that only makes sense during a match. */
function showMatch(playing: boolean): void {
  element('#game').hidden = !playing
  element('#radar').hidden = !playing
  element('#scoreboard').hidden = !playing
  if (!playing) {
    element('#banner').hidden = true
    element('#stats').hidden = true
  }
  if (playing) scene.resize()
}

function save(): void {
  slot.write(serialise(season, squad.all()))
}

/** Say which way the mute went, using the banner the match already has. */
function announceMute(muted: boolean): void {
  if (state) announce(state, muted ? 'Sound off' : 'Sound on')
}

const loop = createLoop({
  update: (dt) => {
    if (state) stepMatch(state, dt, input.read())
  },
  render: (alpha) => {
    if (!state || !sides) return

    // Look at whoever is being considered as a pass target, if anyone is.
    scene.draw(state, alpha, TICK_SECONDS, menu.previewTargetId())
    radar.draw(state, alpha)
    scoreboard.update(state)
    statPanel.update(state, menu.previewsShot())
    ballMarker.update(state, scene.ballMarker())

    // Read off the phase machine from outside, exactly as the renderer reads
    // positions: the simulation is never told anyone is listening.
    const now = snapshot(state)
    if (heard) for (const sound of soundsBetween(heard, now)) sounds.play(sound)
    heard = now
    menu.update(state)
    summary.update(state, () => {
      // Banked exactly once: the summary asks for this only on the frame the
      // match ends, and the result is held until the next match replaces it.
      if (!progress) {
        progress = squad.applyMatch(state!, sides!)
        finishMatch()
      }
      return progress
    })
    overlay.update(loop.stats, state)
  },
})

window.addEventListener('resize', () => {
  scene.resize()
  radar.resize()
})
window.addEventListener('keydown', (event) => {
  // Any key is the gesture browsers insist on before audio may start, and it
  // also revives a context the browser suspended while the tab was away.
  sounds.wake()

  if (event.key === '~' || event.key === '`') overlay.toggle()
  if (event.key === 'm' || event.key === 'M') announceMute(sounds.toggle())
  if (!state) return

  // The same key means the same thing on both sides of the ball: take charge of
  // this moment. On it, stop and look up; off it, go and challenge.
  if (event.key === ' ' || event.key === 'Enter') {
    if (requestActionMenu(state) || requestChallenge(state)) event.preventDefault()
  }

  // Take the defender best placed to challenge. Tab would otherwise move focus.
  if (event.key === 'Tab' || event.key.toLowerCase() === 'q') {
    switchControlled(state)
    event.preventDefault()
  }
})

// A backgrounded tab stops firing rAF; restart cleanly instead of accumulating time.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) loop.stop()
  else loop.start()
})

returnToLeague()
loop.start()

// Dev-only console handle, for inspecting or driving a match from devtools.
if (import.meta.env.DEV) {
  Object.assign(window, {
    blitzball: {
      get state() {
        return state
      },
      get season() {
        return season
      },
      squad,
      loop,
      input,
      scene,
      radar,
      menu,
      statPanel,
      summary,
      league,
      save,
      newSeason: () => {
        slot.clear()
        season = createSeason(
          TEAMS.map((team) => team.id),
          MY_TEAM,
          `blitzball-${Date.now()}`,
        )
        returnToLeague()
      },
      USER_TEAM,
      stepMatch,
      submitEncounterAction,
      submitDefence,
      requestActionMenu,
      requestChallenge,
      cancelActionMenu,
      switchControlled,
    },
  })
}
