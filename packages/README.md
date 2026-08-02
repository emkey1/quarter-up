# packages/

Shared code lives here — but deliberately, **nothing does yet**.

Bracer's `src/engine/` (frame loop, input, gamepad, keyboard, RNG, storage, audio,
speech, display scaling) and parts of its `src/render/` (procedural sprite and tile
generation, the pixel canvas, particles) are obviously reusable. The temptation is to
lift them into `packages/cabinet/` now.

Don't. Extracting from a sample size of one produces an abstraction shaped entirely by
Gauntlet — top-down, eight-way, no gravity — and the second game then has to fight it.

The sequence instead:

1. Build game two by **copying** the engine and generic render files into its own tree.
2. When it plays, diff the two copies.
3. What stayed identical is the real engine. Extract *that* here. What diverged stays
   local to each game, permanently and without apology.

One knot to untie at extraction time: `src/engine/` is clean of `game/`, `ui/` and
`render/` imports, but six files reach up into `@/data/tuning` for `T` and one into
`@/data/rules` for a type. Invert those — pass config in rather than importing it —
and the layer lifts out whole.
