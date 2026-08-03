# packages/

Shared code. One package so far: [`cabinet/`](cabinet) — the parts of the two games that
turned out to be the same code.

## How it got here

The plan, written before there was a second game to compare against, was:

1. Build game two by **copying** the engine into its own tree.
2. When it plays, diff the two copies.
3. What stayed identical is the real engine. Extract *that* here. What diverged stays
   local to each game, permanently and without apology.

This was deliberately not done from a sample size of one, because an abstraction shaped
entirely by Gauntlet — top-down, eight-way, no gravity — is one a platformer then has to
fight. Step 2 happened at M6, and the diff was worth waiting for.

## What the diff actually said

Not one of the seven shared files was byte-identical, which at first reads as "these have
diverged, don't share them". Every difference turned out to be one of four things:

- **A comment referring to one game's DESIGN.md.** Noise.
- **Config reached in from `@/data/tuning`.** Bracer's copy imported `T` from six files;
  Double Bubble's had already been rewritten to take a config object, which is what
  [`config.ts`](cabinet/src/config.ts) now is for both.
- **The game's own vocabulary embedded in a generic type.** `Keyboard` and `GamepadInput`
  both hardcoded Bracer's action names. They are generic over the action set now, and
  each game supplies its own list, default bindings and pad profile.
- **A real difference of policy.** Exactly one: whether a window too narrow for HUD
  flanks drops the right-hand panel or keeps a cramped one. Bracer has no compact
  fallback and would lose the player's only health readout; Double Bubble's HUD already
  sits over the playfield. That is `keepRightPanel`, and both answers are pinned in
  [`display.test.ts`](cabinet/tests/display.test.ts).

`audio.ts` was the clearest case. Its two copies had **byte-identical machinery** —
context lifecycle, mute, volume, throttling, and the four synthesis primitives — and
differed only in the list of sound names and the bodies that play them. So the machinery
is a base class and the voice table is one abstract method. Each game's audio file is now
just its own sounds.

## What stayed local, and why

`cabinet/` holds the loop, display scaling, keyboard, gamepad, RNG, storage and audio
synthesis. It holds nothing else. Still living in each game, permanently:

| Local file | Why it did not move |
| --- | --- |
| `actions.ts` (Bracer), `controls.ts` (both) | The action vocabulary *is* the game. |
| `input.ts` (Bracer) | Merges devices into Gauntlet's fire models. |
| `spatial.ts` (Bracer) | A uniform grid sized to Bracer's tiles. |
| `pointer.ts`, `padlog.ts`, `speech.ts` (Bracer) | One game's UI, diagnostics, announcer. |
| `devices.ts` (Double Bubble) | Its own device-arbitration layer. |
| `audio.ts` (both) | The voice tables. |

`padlog.ts` is the interesting one: it was *inside* Bracer's gamepad class, because
tracking down a controller the browser never surfaced needed evidence that survived page
reloads. That is a debugging tool for one game, not part of an input device — so the
shared class grew a generic `observer` hook and the log attaches from outside.

## The rule

Nothing in `cabinet/` may import from a game's `data/`, `game/`, `render/` or `ui/`.
Config comes in through the constructor. If the shared layer needs to know something
about the game, that is what [`config.ts`](cabinet/src/config.ts) is for — and if it
needs to know something a config field cannot express, that is a sign the code belongs
back in the games.

## Was it worth it

The immediate evidence: a single input bug — polling on frames that take no simulation
step, which silently dropped about half of all keypresses on a 120Hz display — had to be
found and fixed **twice**, in two copies of the same file, because the copies existed.
Its test now lives in `cabinet/tests/loop.test.ts`, once.
