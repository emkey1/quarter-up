# Bracer

A single-player, browser-based dungeon crawler that closely mimics the mechanics of
Atari Games' **Gauntlet** (arcade, 1985) — with modernised presentation and full
keyboard *and* gamepad support.

See [DESIGN.md](DESIGN.md) for the full design and implementation document, including
the research the fidelity tables are drawn from.

Bracer is an unaffiliated homage. It uses no assets, code, or level data from the
original; "Gauntlet" is a trademark of its respective owner.

## Status

**M5 complete** — the campaign: 7 intro levels teaching one idea each and ending on the
arcade's numbered level-select, 40 dungeon levels, treasure rooms every 12, an endless
loop that restarts *after* the intro, and a browser **level editor** with live
playability validation and playtest-in-the-real-game. Polish is M6. See DESIGN.md §12.

| Milestone | State |
| --- | --- |
| M0 skeleton | done |
| M1 combat core | done |
| M2 items, terrain, level flow | done |
| M3 full monster roster | done |
| M4 presentation | done |
| M5 content + editor | done |
| M6 polish | next |

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

```bash
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run build     # typecheck + production bundle
```

## Levels

Two ways to make one, and they share a definition of "playable".

**The editor** — open http://localhost:5173/editor.html. Paint terrain, drop objects,
load any shipped level as a starting point, export JSON. Two things make it worth using
rather than editing JSON by hand:

- **Validation runs on every edit**, with the verdict always on screen and unreachable
  floor tinted red directly on the grid. Sealed rooms are visible, not discovered.
- **Playtest opens the real game** with your level as a one-level campaign — not a
  preview of the game, which would only teach you to trust a lie.

**The generator** — `node tools/mkcampaign.mjs` rebuilds the whole 50-level campaign
from recipes written against the design vocabulary in `tools/levelkit.mjs` (`nest`,
`keyDoorGate`, `coverLattice`, `lobberGallery`, `deathCorridor`, `foodGauntlet`,
`treasureVault`, …). Being straight about what that is: **parameterised hand-design**.
The patterns and where they go are chosen deliberately, level by level; the grain inside
a pattern is generated. That is a long way from noise, and a long way from forty
individually hand-drawn mazes.

The authority on "playable" is `analyseLevel()` in `src/game/analyse.ts`: reachability
from the start with traps *fired* rather than exempted, nothing stranded behind a wall,
food present on any level where health drains. The editor shows its verdict live, and a
test runs it over every shipped level — so the editor cannot bless a level CI rejects.
The generator carries its own pre-flight check for fast feedback while writing, but that
test is the gate: a level that cannot be finished fails the build instead of shipping.

The trap-firing matters more than it sounds. A vault whose only door is opened by a
pressure plate looks sealed to a naive flood fill, and the tempting fix — an exemption
for "sealed by design" — is exactly what hid a genuinely sealed vault, eighteen
treasures and an upgrade behind it, for a whole milestone. Nothing is exempt; the plate
is simulated instead.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move (8-way) | Arrows / `WASD` | D-pad or left stick |
| Fire | `Space` / `J` | `A` or right trigger |
| Magic | `Shift` / `K` | `B` or left trigger |
| Face lock | `Alt` / `L` | `X` |
| Pause | `P` / `Esc` | `Start` |

`Tab` opens setup, `G` controller setup, `M` mutes, `[` `]` change scale, `F`
fullscreen. Development hotkeys: `O` cycles the fire model, `N` skips a level.

### Controller not working?

Press **`G`** for the controller setup screen. It reports, in order: whether the
Gamepad API exists, whether the window is focused and visible, how many pads the
browser admits to, each pad's id and mapping, and live axis/button readouts — then lets
you rebind any action by pressing the control you want.

The two usual causes:

1. **The browser hasn't been shown the controller yet.** Browsers hide gamepads until a
   button is pressed on the pad *while that page has focus*, and never expose them to a
   background or unfocused tab. Click the page, then press a controller button.
2. **The pad reports a non-standard mapping.** Arcade sticks and older pads often do,
   and then the W3C standard button indices are simply wrong for it. The setup screen
   shows `mapping: non-standard` when this is the case; rebind and it is stored per
   device id in `localStorage`.

Rebinding all four directions to stick axes is recognised and promoted back to proper
8-way octant quantisation, rather than being treated as four independent buttons.

### Setup screen — feature toggles

**`Tab`** opens the setup screen. Every monster family can be switched off individually
(ghosts, grunts, demons, sorcerers, lobbers, Death, the Thief), along with the health
drain, the rank curve, off-screen generator gating, and each reconstructed mechanic.

This is not a bolt-on: the cabinet shipped with operator DIP switches for difficulty,
starting health and monster speed, so a rules screen is the descendant of those. It also
serves accessibility, level authoring, and the §13 fidelity work — every constant marked
`[i]` in `tuning.ts` is a guess, and being able to flip the mechanic it drives at runtime
is how those guesses get settled.

Disabling a monster family **removes its generators** rather than substituting another
kind, which would silently rewrite the level designer's intent while appearing to
respect it.

Changing anything is visible. The eligibility tier — **Arcade**, **Tagged**, or
**Ineligible** — is derived from the rules on every frame and shown in-game whenever it
is not Arcade, so an easier run can never quietly look like a real one.

### Fire models

Holding Fire roots you in place — that is authentic, and it is why tapping fire beats
holding it. Because it translates badly to a keyboard, it is selectable (DESIGN.md §5.2):

- **Arcade** — roots whenever Fire is held. Default on gamepad.
- **Feathered** — roots, except for the first 6 frames of a press. Default on keyboard.
- **Free fire** / **Twin-stick** — no rooting; documented deviations.

The per-device defaults are provisional and get settled by the M1 playtest gate, not by
this file.

## Architecture notes

Two rules the codebase enforces rather than merely documents:

1. **`step()` never renders; `draw()` never mutates.** That is what makes headless
   replay testing possible.
2. **Nothing in `src/game/` may reference a screen pixel.** The world is measured in
   *world units*; only `src/render/` multiplies by pixels-per-world-unit. This is what
   lets the art scale change without changing the game, and it is checked by
   `tests/scale.test.ts` — both structurally (import scanning) and behaviourally (an
   identical replay at three different art scales).

The gameplay viewport (232×240 world units) is a **gameplay constant, not a
presentation one**: generators are inert off-screen and potions are viewport-scoped.
Art scale and screen scale vary freely; the viewport does not.
