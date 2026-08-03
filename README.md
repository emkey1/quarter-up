# Quarter Up

Recreations of 1980s arcade games, built for the browser — TypeScript, canvas, no
runtime dependencies, keyboard and gamepad throughout.

Each game is a faithful reconstruction of its original's *mechanics*, researched from
disassemblies and primary sources rather than from memory, with modernised presentation.
None of them use assets, code, or level data from the originals.

| Game | After | State |
| --- | --- | --- |
| [Bracer](games/bracer) | Gauntlet (Atari Games, 1985) | M5 complete — 50 levels, level editor. Polish (M6) next |
| [Double Bubble](games/double-bubble) | Bubble Bobble (Taito, 1986) | M5 all but the room editor — 100 rooms, boss, true ending |

Each game's own `DESIGN.md` carries the authoritative status; this table is a summary and
will lag it. Two things outstanding worth knowing about here:

- **Double Bubble's physics constants are still `[i]` placeholders** — internally
  consistent and instrumented (`F1` shows measured against predicted) but never checked
  against frame-stepped footage. Everything built on top inherits any error in them.
- **M6 is the shared-package extraction**, not just polish. `packages/` stays empty until
  then on purpose: the engine was copied into Double Bubble at M0 so the two could
  diverge under real use, and what stayed identical gets lifted out once there is
  evidence rather than a guess. See [packages/README.md](packages/README.md).

## Layout

```
quarter-up/
  index.html          cabinet-select page for the assembled site
  tools/              repo-level tooling (the arcade build)
  games/<game>/       one game: self-contained, own Vite config, own DESIGN.md
  packages/           shared code — deliberately empty for now, see packages/README.md
```

Games are npm workspaces. Each one is independently runnable and shippable; the arcade
build is a thin layer that stitches their outputs together.

## Working on it

```bash
npm install
```

Run one game's dev server:

```bash
npm run dev -w games/bracer
```

Test, typecheck, or lint every game at once:

```bash
npm test
```

Build the whole arcade into `dist/` — every game plus the cabinet-select page:

```bash
npm run build
```

## Why one repo

The games share a substrate — frame loop, input and gamepad handling, RNG, persistence,
display scaling, procedural sprite generation — but share almost no *game* code, since a
top-down crawler and a gravity platformer have little in common below the cabinet.

Keeping them together means a fix to gamepad handling is one commit rather than a publish
and two version bumps, and it keeps the split reversible: `git subtree split` lifts a game
out with its history intact, whereas merging separate repos later does not go as well.

The shared package is deliberately deferred until two games exist to extract it from.
See [packages/README.md](packages/README.md).
