# Bracer

A single-player, browser-based dungeon crawler that closely mimics the mechanics of
Atari Games' **Gauntlet** (arcade, 1985) — with modernised presentation and full
keyboard *and* gamepad support.

See [DESIGN.md](DESIGN.md) for the full design and implementation document, including
the research the fidelity tables are drawn from.

Bracer is an unaffiliated homage. It uses no assets, code, or level data from the
original; "Gauntlet" is a trademark of its respective owner.

## Status

**M0 complete** — engine skeleton, input, collision, camera, autotiled rendering.
Combat arrives in M1. See DESIGN.md §12 for the milestone plan.

| Milestone | State |
| --- | --- |
| M0 skeleton | done |
| M1 combat core | next |
| M2 items, terrain, level flow | |
| M3 full monster roster | |
| M4 presentation | |
| M5 content + editor | |
| M6 polish | |

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

Regenerate the development level:

```bash
node tools/mkproving.mjs
```

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move (8-way) | Arrows / `WASD` | D-pad or left stick |
| Fire | `Space` / `J` | `A` or right trigger |
| Magic | `Shift` / `K` | `B` or left trigger |
| Face lock | `Alt` / `L` | `X` |
| Pause | `P` / `Esc` | `Start` |

Development hotkeys: `G` opens controller setup, `O` cycles the fire model, `1`–`4`
switch class, `R` resets, `[` `]` change scale, `F` toggles fullscreen.

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
