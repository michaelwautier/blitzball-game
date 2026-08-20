# Blitzball

A browser-playable recreation of the Blitzball minigame from Final Fantasy X.
Personal fan project — not affiliated with Square Enix.

Real-time swimming in a 3D sphere pool — with the old top-down view kept as a corner
radar — and the classic pause-and-menu encounters (Breakthrough / Pass / Shoot)
resolved by stat-vs-stat rolls. Techniques, player levelling, and a six-team league
season that saves between visits. Recruiting is still to come.

See [PLAN.md](PLAN.md) for the full design and phased roadmap.

## Stack

Vite + TypeScript. `three` for the pool, Canvas for the radar, DOM for the menus, and a
deterministic simulation core underneath that none of them can reach into.

## Development

```sh
npm install
npm run dev
```
