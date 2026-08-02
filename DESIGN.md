# Bracer — Design & Implementation Document

A browser-based, single-player dungeon crawler that closely mimics the mechanics, feel, and
presentation of Atari Games' **Gauntlet** (arcade, 1985).

**Status:** design v2 — **M0–M5 implemented** (§12), including the setup screen (§6.6), the 50-level campaign (§11) and the level editor (§11.1). Polish (M6) next.
**Target:** modern desktop browsers, keyboard **or gamepad**, 60 Hz fixed-step simulation,
HTML5 Canvas, art at 2× the original's resolution.

---

## Table of contents

1. [Goals and non-goals](#1-goals-and-non-goals)
2. [Legal / originality constraint](#2-legal--originality-constraint)
3. [Reference: how the original works](#3-reference-how-the-original-works)
4. [Single-player adaptation decisions](#4-single-player-adaptation-decisions)
5. [Controls](#5-controls)
6. [Presentation spec](#6-presentation-spec)
7. [Technical architecture](#7-technical-architecture)
8. [Core systems in detail](#8-core-systems-in-detail)
9. [Data formats](#9-data-formats)
10. [Tuning constants](#10-tuning-constants)
11. [Content plan](#11-content-plan)
12. [Implementation milestones](#12-implementation-milestones)
13. [Testing and fidelity validation](#13-testing-and-fidelity-validation)
14. [Risks and open questions](#14-risks-and-open-questions)
15. [Sources](#15-sources)

---

## 1. Goals and non-goals

### Goals

- **Mechanical fidelity first.** The moment-to-moment feel — continuous health drain, generator
  pressure, shot/melee/magic triad, monster traffic jams, precision positioning — should be
  recognisably Gauntlet to someone who played the cabinet.
- **Single player from the ground up.** Not "4-player game with 3 players missing." Every
  multiplayer-specific system is either removed or deliberately reworked (§4).
- **Keyboard and gamepad, equally first-class.** No mouse. The cabinet was an 8-way stick plus two
  buttons; a gamepad is the closer analogue and is supported from M0, not bolted on later.
- **Modernised presentation, unmodernised gameplay.** Art, lighting, particles, and UI are
  upgraded well past 1985. The *world-space* viewport, tile grid, and every gameplay number stay
  faithful (§6.1 explains why the viewport specifically cannot move).
- **Runs from a static file server.** No backend. Local storage for scores/settings only.
- **Deterministic simulation.** Seeded RNG, fixed timestep, so replays and automated tests work.

### Non-goals

- Multiplayer (local or online). The architecture should not *preclude* it, but no work is spent on it.
  **Noted as a wanted follow-on** (see §4.14): a local 4-player mode after the single-player game
  is finished. Nothing in this document should be implemented in a way that makes that harder
  than it needs to be.
- Mobile / touch controls.
- Gauntlet II / Legends / Dark Legacy features (Quest mode, character classes beyond the four,
  invisible walls, "It's a trap!" etc.).
- Reproducing Atari's exact maze layouts or artwork (see §2).

---

## 2. Legal / originality constraint

This is worth stating up front because it shapes the art, audio, and level pipelines.

Game *mechanics and rules are not copyrightable* — reimplementing Gauntlet's systems is fine.
The following are **not** reproduced:

| Asset | Constraint | Our approach |
| --- | --- | --- |
| Sprite/tile artwork | Copyrighted | Original pixel art authored for this project at **32×32 per block** (2× the original) with a wider palette, 8 facings, and more animation frames. Recognisably the same archetypes, not the same pixels. |
| Speech samples (Ernie Fosselius / TMS5220C) | Copyrighted recording | Web Speech API (`speechSynthesis`) with pitch/rate tuned to a robotic register, plus on-screen captions. Original phrasing, same *function*. |
| Music / SFX | Copyrighted | Synthesised in Web Audio from scratch. |
| Maze layouts (the 100+ levels) | Arguably copyrightable compilation | Original mazes authored by us, using the original's *design vocabulary* (generator nests, chokepoints, key/door flood control, treasure vaults). See §11. |
| The name "Gauntlet", Atari logo | Trademark | Project is named **Bracer**. Ship a visible "unaffiliated homage" note. |

None of this is a fidelity compromise on gameplay — it's a compromise on pixels and mazes only.

---

## 3. Reference: how the original works

Everything in this section is sourced (§15). Values marked **[inferred]** are our best
reconstruction where no authoritative number was found; they are tuning knobs, not facts.

### 3.1 Hardware / presentation facts

From the MAME driver (`src/mame/atari/gauntlet.cpp`):

- Video: **336×240 visible**, 456×262 total, pixel clock 7.159090 MHz → **≈59.92 Hz**.
- Playfield tilemap: **64×64 tiles of 8×8 px** = 512×512 px world, `TILEMAP_SCAN_COLS`.
  Maze blocks are 2×2 tiles = **16×16 px**, so a level is a **32×32 block grid**.
- Separate 64×31 8×8 alphanumeric tilemap for the HUD text.
- CPU 68010 @ 7.16 MHz, audio 6502 + YM2151 + POKEY + **TMS5220C speech**.

From a native-resolution screenshot: the status panel is a **right-hand vertical column starting
at x≈232**, so the playfield window is roughly **232×240 px** — about **14.5 × 15 blocks visible**.
The panel shows the logo, `LEVEL n`, then per player: class name, score multiplier, `SCORE`,
`HEALTH`, and the footer `1 COIN = 700 HEALTH`.

**The viewport size is a gameplay parameter, not just presentation:** generators do not spawn
while off-screen, which is a core tactic. Do not widen the playfield window casually.

### 3.2 Health economy

- Start with **700 health** per credit.
- Health drains **1 point per second**, always.
- **Food = +100 health**, and +100 points.
- Monster damage dwarfs the drain; the drain is a clock, not a threat.
- Health is *not* converted to score at game over.

### 3.3 Characters (arcade, final revision — tested values)

Two stats matter far more than the rest: **magic vs. generators** and **shot collision box**.

| Stat | Warrior (Thor) | Valkyrie (Thyra) | Wizard (Merlin) | Elf (Questor) |
| --- | --- | --- | --- | --- |
| Armor (damage reduction) | 20% → 30% | 30% → 40% | 0% → 10% | 10% → 20% |
| Shot strength | 2 → 2~3 HP | 1 → 2 HP | 1~2 → 2 HP | 1 → 2 HP |
| Shot travel speed | 2 → 3 | 3 → 3.5 | 3.5 → 5 | 3.5 → 5 |
| Shot collision box | **Large** | Medium | Medium | **Small** |
| Magic vs monsters | 2 → 3 HP | 2/3\* → 3 HP | 3 → 3 HP | 3 → 3 HP |
| Magic vs generators | **0** → 1 HP | 0/1\* → 1/2\* HP | **3** → 3 HP | 2 → 3 HP |
| Potion-shot vs monsters | 1 → 3 HP | 1/2\* → 3 HP | 3 → 3 HP | 3 → 3 HP |
| Potion-shot vs generators | 0 → 1 HP | 0 → 1 HP | 2 → 3 HP | 1 → 2 HP |
| Melee vs monsters | 2~3 → 3 HP | 2 → 3 HP | 1 → 2 HP | 1~2 → 2~3 HP |
| Melee vs generators | low miss% → none | med miss% → none | always misses | always misses → high miss% |
| Running speed | 1 → 3 | 2 → 3 | 1 → 3 | **3 → 5** |

`a → b` = base → after the matching Extra-* upgrade potion. `a~b` = random in range.
`*` = Valkyrie's magic does +1 against block-type generators and their spawn.

Consensus (and ours): **Elf is the strongest solo pick** — speed plus near-Wizard magic.
Warrior is the weakest solo pick — his magic can't touch generators at all.

### 3.4 Monsters

Every monster and generator has a **level of 1, 2, or 3**. A generator's level equals its HP and
dictates the level of what it spawns; damaging a generator lowers its level *and* the level of
subsequent spawns. **[inferred]** monster HP = its level (1/2/3).

| Monster | Contact/melee damage (L1/L2/L3) | Behaviour |
| --- | --- | --- |
| **Ghost** | 10 / 20 / 30 | Kamikaze — destroys itself on contact. No attack animation, so the next ghost is instantly on you. The most dangerous common enemy. Spawns from **bone** generators. |
| **Grunt** | 5 / 8 / 10 | Walks to you, clubs repeatedly at melee range. |
| **Demon** | 5 / 8 / 10 melee; **fireball 10 flat** | Grunt that also fires long-range projectiles. Fires whenever roughly in line, *ignoring walls*. Fireballs destroy food jugs, potions, other monsters, and damage generators. |
| **Sorcerer** | 5 / 8 / 10 | Grunt that phases invisible periodically; shots pass through while invisible. |
| **Lobber** | **rock 3 flat** | No melee. Lobs rocks **over walls** with lead prediction. Flees when you get within ~3 blocks. Rocks destroy food/potions/monsters and *fully destroy bone generators*. |
| **Death** | drains up to **200** then vanishes | Never generated; placed. Immune to shots and melee (each shot scores 1 pt and cycles its potion-kill value). Any potion kills it instantly. Drains health rapidly on contact until contact breaks or 200 is spent. |
| **Thief** | 10, plus steals | Never generated; spawns at level start every few levels with a distinctive high tone. Very fast, beelines to the player, steals an upgrade potion (else potion/key/score), then runs for the exit. Killing him drops a 500-pt jewel bag and returns what he took. A stolen upgrade is downgraded to a plain potion. |

**Generators**: two visual families — **bones** (ghosts only) and **blocks** (everything else).
Bones can be *destroyed* by lobber rocks and demon fireballs; blocks can only be *weakened* by them.
Spawns emerge into any of the 8 tiles around the generator.

**Movement/AI feel:** monsters zig-zag toward you when you aren't row/column aligned with them,
which makes them hard to hit and makes a missed shot costly (only one shot on screen at a time).

**Melee is a swing, not an aura.** It reaches `MELEE_REACH` (14 wu) past your own edge,
only within `MELEE_ARC_COS` of your facing, and only if nothing solid is in the way —
including the same sealed-diagonal rule the projectiles use. It was a `[20, 12]` box
centred on the *player* and tested per-axis, which describes a 32 wu square reaching just
as far backwards as forwards, with facing contributing a 6 wu nudge that changed nothing.
Anything that wandered adjacent died, from any direction, through anything: the reported
case was an Elf killing monsters diagonally through a corner sealed by two blocks, where
neither party could possibly have reached the other.

**An open door does not block shots.** A closed one does. It used to block either way, so
a doorway you had just paid a key to unlock — and could walk through — was still a wall to
your own arrows.

**"On screen" is meant literally.** The shot slot is freed when the projectile leaves the
232x240 viewport, not when it finally meets a wall. Tying it to geometry tied the fire rate
to level size: on an open level the shot flew hundreds of world units through terrain
nobody could see, and the grid growing from 32 to 48 quietly made it worse. Measured on
depth 20 before the fix, the Elf's shot left view at frame 40 and held the slot until frame
189 — two and a half seconds unable to fire at something that had not been visible for most
of it. Enemy fire is deliberately exempt: demons shoot through walls from just off screen,
and culling their fireballs on the same rule would disarm them from the very position that
makes them dangerous.
Monsters block each other — deliberate traffic jams at chokepoints are a core player tactic.

### 3.5 Level furniture

| Thing | Rules |
| --- | --- |
| **Wall** | Solid. Two *diagonally adjacent* wall blocks leave a seam that small/medium shots can thread but monsters cannot — the basis of "attack from behind cover." |
| **Breakable wall** | Softer texture, destroyed by shots. |
| **Door** | Any shape; all touching door tiles open with **one key**. Auto-unlock after **18 s** with no combat/pickup activity (**36 s** if you're holding keys). Used deliberately for flood control. |
| **Key** | +100 pts. Shares **12 inventory slots** with potions. Monsters can't pass through a key on the floor, but shots can. |
| **Potion** | Screen-wide smart bomb, strength = the user's magic stats. Only way to kill Death. Orange potions are indestructible; blue ones can be shot (triggering a weaker blast) or destroyed by enemy fire. |
| **Upgrade potion** | Six kinds: Extra Armor / Magic / Shot Power / Shot Speed / Speed / Fight Power. Permanent, **once each**. Duplicates degrade to a plain potion. Announced by yellow text on the level-intro screen ("find the hidden potion"). |
| **Treasure** | +100 pts. Solid to monsters, shootable-through — usable as cover. |
| **Jewel bag** | +500 pts. Dropped by a killed thief. |
| **Food** | +100 health, +100 pts. Most kinds indestructible; **yellow jugs marked ✗✗ can be shot** (the classic "don't shoot the food"). |
| **Trap tile** | Flashing floor tile; stepping on it opens walls elsewhere in the level (often required to reach the exit). |
| **Teleporter** | Sends you to the nearest reachable teleporter; you can steer which of the 8 destination tiles you land on. With multiple destinations, the original picks by *wall-clock seconds mod destination count*. |
| **Invisibility** | ~20 s. Monsters stop tracking you and keep moving in their last direction; firing briefly reveals you; melee stays silent. Carries into the next level. Flash rate slows as it expires. |
| **Exit** | Advances a level. In the 7 intro levels, a trio of numbered exits acts as a **level-skip selector**. |
| **Walls → exits** | Stand completely still for **~180–200 s** and every wall becomes an exit. Legit strategy, banned by some leaderboards. |

### 3.6 Progression, scoring, and the rank system

- 7 intro levels, then **100 levels that loop forever**. There is no ending; score is the goal.
- **Ranking system** (final ROM revisions only): the more points you have, the less food spawns.
  By ~**300,000 points** most food is gone. This is the real difficulty curve.
- Arcade high-score is **points per credit** — feeding credits divides your score.

Scoring (sourced where possible):

| Event | Points |
| --- | --- |
| Ghost killed by shot | 10 × level |
| Grunt / Demon / Sorcerer / Lobber killed by shot | 5 × level |
| Any monster killed by melee | 25 |
| Any monster killed by magic | 10 |
| Generator destroyed | **[inferred]** 50 × level |
| Food, key, treasure | 100 each |
| Jewel bag / shooting the thief | 500 |
| Shooting Death | 1 |
| Killing Death with a potion | cycles **1000 → 2000 → 1000 → 4000 → 2000 → 6000 → 8000 → 1000…**, advanced by each shot that hits Death (shoot it exactly 6× for 8000) |
| Treasure-room exit bonus | 50 × treasures collected |

### 3.7 Announcer

TMS5220C narrator, triggered by game state. Sourced lines include:
`"<Class> needs food badly!"`, `"<Class> is about to die!"`, `"Your life force is running out"`,
`"<Class> shot the food!"`, `"Remember, don't shoot food."`, `"Shots do not hurt other players, yet."`

---

## 4. Single-player adaptation decisions

Each entry: **what changes**, and **why**.

| # | Original (4P) | Bracer (1P) | Rationale |
| --- | --- | --- | --- |
| 4.1 | Insert coin → +700 health, score divided by credits used | **Continues.** Start with 3 (configurable; "Arcade" preset = unlimited). A continue restores 700 health, keeps your level and inventory, and increments a credit counter. Headline stat on the score table is **score ÷ credits**. | Preserves the arcade's actual scoring pressure without a coin slot. |
| 4.2 | Treasure grants a per-player score multiplier up to ×8, stolen from rivals | **Removed.** Treasure is a flat 100 pts. | The multiplier existed purely to make players fight each other. Nothing to preserve solo. |
| 4.3 | Item competition (food, potions) between players | **Removed.** | Same. |
| 4.4 | Generator spawn rate scales with player count | **Keep the 1-player rate**, and author levels for one player. | The original already scales down; the danger is inheriting 4P-designed *level layouts*. We author our own (§11), so we tune generator density for solo play directly. |
| 4.5 | Thief follows the "richest" player | Follows you. | Trivial. |
| 4.6 | Class choice constrained by which classes teammates took | **All four always available.** | — |
| 4.7 | Right-hand panel shows four player boxes | **Redesigned single-player panel** (§6.2): class portrait, score, health bar + number, credits, and a **visible 12-slot inventory** of keys/potions. | The 12-slot inventory is a real mechanic that the arcade never showed. Solo, there's room to show it, and it removes a genuine usability wart. |
| 4.8 | Nothing between you and the horde but a joystick | **Optional "Modern" difficulty preset**: 1000 starting health, 25% slower rank curve, unlimited continues. Default preset is **"Arcade"** (700 / faithful / 3 continues). | Onboarding. The Arcade preset stays untouched and is the one the score table ranks. |
| 4.9 | "Shots do not hurt other players, yet" | Dropped from the announcer pool. | Meaningless solo. |
| 4.10 | 7 intro levels with numbered skip-exits | **Kept.** They double as the solo player's difficulty/depth selector. | Faithful *and* good single-player design. |
| 4.11 | Death-on-level-N conditioning (next game starts at N as level 8) | **Kept as an option**, off by default; on the score table a run is tagged "cold start" or not. | It's a real, well-known arcade behaviour; leaderboards distinguish them. |
| 4.12 | No pause, no save | **Pause (P)** and **resume-from-level save** in `localStorage`. Saving marks the run non-leaderboard-eligible unless it's a clean continue. | Browser games get interrupted. |
| 4.14 | Four players at once, the reason the cabinet had a wide control panel | **Deferred, not abandoned.** A local 4-player mode is wanted *after* the single-player game is finished. See "§4.14 notes" below for what is already compatible and what would have to change. | Building it now would compromise the single-player design (§4.2–4.9 exist precisely because 1P and 4P want different things). Building it *later* is only feasible if we avoid a few specific mistakes now, which is why the notes exist. |
| 4.13 | Operator DIP switches inside the cabinet, set once by the arcade owner | A **setup screen** (§6.6) exposing rules as toggles: individual monster types, Death, the Thief, the health drain, the rank curve, and the reconstructed mechanics. | This is the descendant of the DIP switches, not an invention — the cabinet shipped with difficulty, starting health and monster-speed switches an operator could set. Moving them in front of the player is the single-player equivalent, and it also serves accessibility and the §13 fidelity work. |

Everything else — health drain, damage numbers, stat tables, generator rules, door timers, the
180 s wall-to-exit trick, the rank system, the Death potion-value cycle — is preserved exactly.

---

### §4.14 notes — keeping the door open to 4 players

Not a plan, just a standing constraint on decisions taken between now and then.

**Already compatible, by accident or design:**

- Input reduces every device to an `ActionState` before the simulation sees it, and the
  gamepad layer tracks pads *by slot* across all four Gamepad API slots with per-device-id
  binding profiles. Four `ActionState`s is a list, not a redesign.
- The simulation takes actions as a parameter rather than reading input; nothing in
  `src/game/` knows what a device is.
- Rules, run state and level flow are already values passed around, not globals.

**What would have to change, and is worth knowing now:**

| Area | Issue |
| --- | --- |
| `World.player` | Singular. Would become a list; every `this.player` is then a decision about *which* player, and most answer "the one who did the thing". |
| Camera | Follows one point. The arcade followed the group and let stragglers push the edge — a genuinely fiddly problem, and the reason 4P levels are laid out differently. |
| Viewport-scoped rules | Potions and off-screen generators key off *the* camera. With one shared camera that still works; it is the one thing that gets simpler. |
| Scoring | §4.2 deletes the treasure multiplier because it exists to make players fight each other. It would come *back* for 4P — so it should be deleted behind a rule rather than ripped out. |
| HUD | §6.2's single-player panel is the opposite trade from the arcade's four boxes. Both layouts would need to exist. |
| Levels | The 40 authored levels (M5) are tuned for one player. 4P wants different generator density and more chokepoints. Level files should carry a player-count hint rather than being silently reused. |

**The one rule to follow meanwhile:** when something is per-player, put it on the player
object rather than on the world. That is nearly free now and is most of the work later.


## 5. Controls

The cabinet was an 8-way digital joystick plus **Fire** and **Magic** buttons. A gamepad maps onto
that almost exactly; a keyboard is the compromise. Both are supported from M0 and are equal
citizens — the simulation never sees a device, only an `ActionState` (§5.4).

### 5.1 Bindings

| Action | Keyboard | Alternate | Gamepad (standard mapping) |
| --- | --- | --- | --- |
| Move (8-way) | Arrow keys | `W A S D` | D-pad **or** left stick |
| Fire | `Space` | `J` | `A` / cross, **or** right trigger |
| Use potion (magic) | `Shift` (either) | `K` | `B` / circle, **or** left trigger |
| Face-lock / strafe (hold) | `Alt` | `L` | `X` / square |
| Aim (twin-stick mode only) | Arrow keys | — | right stick |
| Pause | `P` | `Esc` | `Start` |
| Mute | `M` | — | — |
| Fullscreen / rescale | `F` / `[` `]` | — | — |
| Menus | Arrows + `Enter`, `Esc` back | — | D-pad + `A`, `B` back |

Everything is remappable in Options. Keyboard uses `event.code` (physical keys, layout-independent).

### 5.2 The immobilisation question

In the original, **holding Fire stops your character** — which is exactly why skilled play is
*tapping* fire rather than holding it. It's not an implementation artefact, it's the cost that
makes ranged attack a decision instead of a default.

It also translates badly to a keyboard, where "my movement key is held but I'm not moving" reads
as input lag rather than as a tradeoff. So it is a selectable **fire model**, not a hard-coded rule:

| Fire model | Behaviour | Leaderboard |
| --- | --- | --- |
| **Arcade** (default on gamepad) | Holding Fire immobilises; facing locks to last movement direction; auto-fire gated by the one-shot-on-screen rule. | Eligible |
| **Feathered** (default on keyboard) | Immobilises, but the first **6 frames** of a Fire press don't — a quick tap while running costs nothing, holding still roots you. Preserves the tap-vs-hold skill while removing the "sticky keys" feel. | Eligible, tagged |
| **Free-fire** | No immobilisation; you shoot in your facing direction while moving. | Ineligible |
| **Twin-stick** | Move and aim independently (right stick, or arrows while `WASD` moves). | Ineligible |

Feathered is my recommendation as the keyboard default: it keeps the mechanic legible, and the
6-frame window is short enough that sustained fire still roots you exactly as it should.

Two implementation requirements that matter more than the model choice:

- **Zero-latency release.** Releasing Fire must resume movement on the *same* step, using movement
  input that was held throughout. Never consume-and-discard direction input during immobilisation.
- **Facing updates while rooted.** You can turn on the spot while firing; only translation stops.
  Without this, Arcade mode is unplayable rather than merely demanding.

`holdFireStops` from v1 of this doc is superseded by `fireModel`.

### 5.3 Gamepad specifics

- **Polled, not evented.** `navigator.getGamepads()` is read once at the top of each rendered
  frame, and that snapshot is reused for every fixed step in that frame. Documented, because it
  makes replay determinism well-defined (§13).
- **Hot-plug** via `gamepadconnected` / `gamepaddisconnected`; the HUD shows a brief
  "controller connected" toast and the active input device.
- **8-way quantisation by default.** The cabinet stick was digital. An analog stick is quantised
  to the 8 compass directions with a **0.35 deadzone** and a **0.10 hysteresis band** so diagonals
  don't chatter. `analogMovement` (360°, unquantised) is an option and a documented deviation —
  it measurably changes dodging.
- **D-pad preferred when both are active.** If any d-pad button is down, the stick is ignored that
  frame; prevents fighting between the two.
- **Non-standard pads.** Arcade sticks, HOTAS, and older pads often report
  `mapping !== "standard"`, and some expose the hat as a strangely-valued axis. Options has a
  **"press the control you want"** detection flow that accepts any button index, any axis
  (positive or negative half), and hat-axis values, and stores a per-device-id profile.
- **Analog triggers** are treated as buttons at a 0.5 threshold.
- **Rumble** via `vibrationActuator` where available: short pulse on taking damage, longer on
  potion detonation and player death. Off by default (it's not arcade), respects
  `prefers-reduced-motion`.

### 5.4 Input abstraction

```ts
interface ActionState {          // the ONLY thing the simulation sees
  moveX: -1 | 0 | 1;             // already quantised
  moveY: -1 | 0 | 1;
  aimX: -1 | 0 | 1;              // twin-stick only; else equals facing
  aimY: -1 | 0 | 1;
  fire: boolean;   firePressed: boolean;
  magic: boolean;  magicPressed: boolean;
  faceLock: boolean;
}
```

Keyboard and gamepad both reduce to this before `step()`. Replays record `ActionState` per frame,
so a keyboard replay and a gamepad replay are the same artefact.

### 5.5 Other notes

- **Melee is not a button.** Walking into a monster attacks it, as in the original. Ghosts cannot
  be meleed — they self-destruct on contact first.
- Prevent default on arrows and space so the page never scrolls.
- **Key ghosting**: cheap keyboards drop the third simultaneous key. Defaults use `Space` and
  `Shift`, which sit on separate matrix rows on nearly all keyboards. Options includes a rollover
  tester that shows how many of your keys register at once — and recommends a gamepad if it fails.

---

## 6. Presentation spec

### 6.1 World units vs. pixels — the one thing that must not drift

Graphics are upgraded; **the world-space viewport is not**. Three original mechanics are defined
in terms of how much maze you can see:

1. Generators are inert while off-screen — the basis of the "snipe it from off-screen" tactic.
2. Potions damage everything **in the viewport**, not the level.
3. Monsters despawn/idle outside it, so what you can see is what is coming for you.

Widen the window and you change generator pressure, potion value, and the entire risk calculus.
So the codebase separates two scales that the arcade conflated:

| Quantity | Value | May change? |
| --- | --- | --- |
| Block | **16 world units (wu)** | No |
| Level | 48 × 48 blocks = 768 × 768 wu | Raised from 32 after playtesting — see §6.8 |
| **Gameplay viewport** | **232 × 240 wu** (14.5 × 15 blocks) | **No** — locked in Arcade preset |
| Art scale `A` | **2 px per wu** (32×32 px per block) | Yes — this is the upgrade |
| Screen scale `S` | 1–3, integer, auto-fit to window | Yes |

Playfield pixel size = `232·A·S × 240·A·S`. At the default `A=2, S=2` that's **928 × 960** —
comfortable on a 1080p window with room for HUD flanks, and a genuine step up from 232×240.

- Canvas is sized to the window at `devicePixelRatio`; the playfield is rendered to an offscreen
  buffer at `A·S` and blitted with `imageSmoothingEnabled = false`, so pixel art stays crisp.
- Scrolling is smooth at sub-world-unit precision — at `A=2` the camera moves in half-world-unit
  steps, which is finer than the arcade managed and costs nothing.
- Arcade ran at 59.92 Hz; we run a **fixed 60 Hz simulation**. The 0.13% difference is inaudible
  and invisible. Documented, not corrected.
- **Widescreen toggle** (off by default) extends the gameplay viewport horizontally to fill a 16:9
  window. This is an explicit gameplay deviation for exactly the reasons above, is labelled as one
  in the menu, and makes a run leaderboard-ineligible.

### 6.2 Screen layout (single player)

A 16:9 window with a locked ~0.97:1 playfield leaves generous flanks. Those become the HUD rather
than black bars — the arcade's four cramped player boxes collapse into one player's worth of
information with room to spare:

```
+--------------+---------------------------+--------------+
| BRACER       |                           |  ELF         |  class art + colour
| LEVEL 12     |                           |  SCORE       |
|              |        PLAYFIELD          |    16340     |
| KEYS         |      232 x 240 wu         |  HEALTH      |
| [][][]       |    (14.5 x 15 blocks)     |    413       |  bar + number,
|              |                           |  [========-] |  pulses red < 200
| POTIONS      |     928 x 960 px          |              |
| [][][][]     |       @ A=2, S=2          |  UPGRADES    |  6 slots, lit when owned
|              |                           |  [A][M][P]   |
| CREDITS  2   |                           |  [S][V][F]   |
+--------------+---------------------------+--------------+
```

- 12 inventory slots are shown split across keys and potions — the arcade never displayed them
  and running into a full inventory was invisible and confusing.
- The six upgrade-potion slots are shown lit/unlit, which turns "did I already take Extra Speed?"
  from guesswork into information.
- Class colours follow the original panel: Warrior red, Valkyrie blue, Wizard yellow, Elf green.
  A colour-blind-safe alternate palette is available in Options.
- At window widths too narrow for flanks, the HUD collapses to a single right-hand column
  (the arcade arrangement) and then to a compact overlay bar.

### 6.3 Screens

1. **Attract** — looping demo of a mid-level with announcer tips and high-score table.
2. **Character select** — the four classes with their stat bars (the table from §3.3, drawn as
   six 1–5 bars) and a one-line description.
3. **Level intro** — black screen, `LEVEL n`, `YOU HAVE ENTERED THE DUNGEON`, plus yellow
   `FIND THE HIDDEN POTION!` when the level has an upgrade. Beat of ~2.5 s, skippable.
4. **Play**.
5. **Game over** — final score, credits used, score-per-credit, deepest level, initials entry.
6. **Setup** — rules and feature toggles (§6.6).
7. **Options / Controls / About**.

### 6.4 Art plan (upgraded)

Everything is authored at **A=2** — 32×32 px per 16 wu block. That is the sweet spot: visibly
more detailed than the original, still hand-authorable by one person, and it scales to integer
multiples cleanly.

*Second pass, after the maze density went up.* Two things that were survivable on sparse
levels became the first thing you noticed at 27% wall coverage:

- The atlas baked **one tile per blob mask, always with salt 1**, so every wall in the game
  sharing a mask was pixel-identical. Now three weathering variants per mask, chosen by
  cell position — appearance is a property of *where a tile is*, so it never changes
  between frames or between runs.
- **Four floor stamps** across 2000+ floor tiles read as wallpaper: the eye finds the
  period before it finds the dungeon. Now eight, with per-flagstone tone variation and
  distinct cracks, chips and loose stones per variant.
- The south edge of a wall is its **front face**, and it does most of the work of making a
  top-down block read as having height. Three pixels was too thin to register once scaled
  up next to a dozen neighbours; it is six now, in two tones with the mortar carried down
  it.

- **Tiles**: 32×32. **Wall autotiling** with a 47-piece blob set driven by an 8-neighbour bitmask,
  so mazes read as built structures with corners, caps and junctions instead of loose cubes. This
  is the single biggest visual upgrade per hour spent. Plus floor variants (4 per theme, chosen by
  a positional hash), floor decals/cracks, breakable wall, door (closed/opening/open), exit,
  teleporter, trap tile. **6 dungeon themes** cycling over the campaign.
- **Sprites**: 32×32, **8 facings** (matching 8-way movement — the original mostly had 4),
  6-frame walk cycles, plus attack, hurt-flash, spawn, and death-dissolve animations.
  4 classes + 5 monster types × 3 levels + Death + Thief + 2 generator families × 3 levels
  + items + projectiles.
- **Monster levels are palette swaps**, not redraws — one art set per monster type, three ramps.
  This is what keeps the art budget sane.
- **Lighting**: a half-resolution light buffer composited with `globalCompositeOperation`.
  Radial glows for generators (pulsing as they charge a spawn — free telegraphing), potions,
  shots and fireballs in flight, exits, and a soft ambient falloff at level edges. Costs one
  half-res pass per frame.
- **Particles**: monster dissolve motes, generator explosion debris, rock impact dust, potion
  shockwave ring, footstep puffs. Pooled, capped at 400 live.
- **Screen effects**: potion white-flash + shake, damage vignette pulse, and a two-frame camera
  *punch* on a generator kill.

  > **Correction, M4.** This originally specified *hit-stop*. Hit-stop cannot be used here:
  > pausing the simulation for two frames would shift the fixed-step clock, and with it the
  > health drain, every terrain timer, and every recorded replay — a presentation effect
  > silently changing the game. The camera punch delivers the same impact for free. The
  > damage vignette is also deliberately **not** gated by `prefers-reduced-motion`: it is
  > information about your health, not decoration. It simply stops pulsing.
- **UI**: crisp modern typography for the HUD (a real webfont, not a bitmap font), with the
  arcade's colour language retained. In-world text (level intro, announcer captions) uses a
  pixel font at 2× to stay in register with the art.
- **Authoring pipeline**: Aseprite → PNG atlases + JSON frame data, imported by Vite. (v1 of this
  doc proposed embedding pixel data in TS source; at 32×32 with 8 facings that is no longer
  reasonable, so we take a real asset-loading step and a loading screen.)

  > **Reality check, recorded during M4.** Hand-drawn art requires a human artist, and this
  > project does not have one. What is actually shipping is **algorithmically generated art**,
  > baked into offscreen canvases at startup: structured behind exactly the interface a PNG
  > atlas would use, but not hand-drawn and not pretending to be. Dropping in real atlases
  > later is a change of one module. A staffing limitation stated plainly, not a design
  > decision.
  >
  > **M4c correction.** The first attempt at this was worse than it needed to be for a reason
  > that had nothing to do with the missing artist: it drew with `ctx.arc()` and
  > `ctx.fillRect()` at *display* resolution, producing anti-aliased vector shapes. That can
  > never read as pixel art whatever the palette does — it is a technique problem, not a
  > resolution or staffing problem. M4c replaced it with a real indexed-palette pixel buffer
  > (`render/pixel.ts`) authored at native 32×32 and blitted nearest-neighbour, applying the
  > craft rules that actually matter at this size: silhouette first, a hard 1px outline on
  > everything, one light direction applied as a pass over whole ramps, five shade steps,
  > dithering for gradients, and stone-course texture on walls. Recolouring is still a palette
  > swap, so monster levels and class tints cost nothing.
- **Optional CRT overlay** (scanlines + slight bloom), off by default. It's a garnish now, not
  the look.

Renderer stays **Canvas 2D**. The frame is one playfield blit, a few hundred sprite draws, one
half-res light pass, and the HUD — comfortably 60 fps. `render/` is written behind a small
`Renderer` interface so a WebGL backend can be swapped in if the light/particle budget ever grows,
but that is explicitly not planned.

### 6.5 Audio plan

Web Audio, all synthesised. `AudioContext` created lazily and resumed on first keypress
(autoplay policy).

| Sound | Synthesis |
| --- | --- |
| Player shot | short square blip, downward pitch sweep |
| Shot hits wall | filtered noise click |
| Monster death (per family) | noise burst + pitch-swept triangle |
| Generator destroyed | layered noise + low sine thump |
| Potion detonation | white noise swell through a sweeping lowpass, ~1.2 s |
| Pickups (food/key/treasure/potion) | distinct 2–3 note arpeggios |
| Door opens | descending square pair |
| Teleport | rising sine chirp |
| **Thief tone** | distinctive sustained high sine — must be instantly recognisable, it's a warning |
| Player death | long descending sweep + noise |
| Level start | 6-note fanfare |

**Announcer** via `speechSynthesis`: rate ~0.85, pitch ~0.6, prefer an English voice, queued with
a hard rate limit (max 1 line per 4 s, drop rather than back up). Every line also renders as a
caption at the bottom of the playfield for ~2 s, so the game is fully playable muted or on
browsers with no voices installed. Trigger table:

| Trigger | Line |
| --- | --- |
| health crosses below 200, then every 15 s | `<Class> needs food badly!` |
| health crosses below 100 | `<Class> is about to die!` |
| player shot a destructible food item | `<Class> shot the food!` |
| level intro, occasionally | `Remember, don't shoot food.` |
| thief spawns | `Beware — the thief approaches!` |
| Death spawns on screen | `Death is upon you.` |
| player dies | `<Class> has died.` |
| level with an upgrade potion | `A potion lies hidden here.` |

---

### 6.6 Setup screen — rules and feature toggles

A screen that turns individual game systems on and off: each monster family, Death, the
Thief, the health drain, the rank curve, and the mechanics reconstructed from inference.

**Why this exists**, in order of weight:

1. **It is the DIP switches.** The cabinet shipped with operator switches for difficulty,
   starting health and monster speed. Nothing about a rules screen is foreign to
   Gauntlet; the only change is who holds the screwdriver.
2. **Accessibility.** Death and the continuous drain are the two things that most often
   end a new player's run before they have learned anything. Being able to switch off a
   single monster is a far better answer than a global "easy mode" that changes
   everything at once.
3. **It is the harness for §13.** Every constant tagged `[i]` is a guess. Being able to
   flip corner assist, diagonal normalisation or the corner-squeeze rule at runtime and
   A/B them against a reference recording is how those guesses get settled. This screen
   is a development instrument that happens to also be a player feature.
4. **Authoring.** Isolating one monster type is the fastest way to tune it, and level
   design needs that constantly.

**Leaderboard integrity.** The same three-tier scheme the fire models use (§5.2):

| Tier | Meaning |
| --- | --- |
| **Arcade** | Every rule at its faithful default. Fully eligible. |
| **Tagged** | Deviations that change feel but not difficulty in an obvious direction (e.g. Feathered fire, diagonal normalisation). Eligible, marked on the score table. |
| **Ineligible** | Anything that removes pressure: a disabled monster, no drain, no rank curve, free-fire, twin-stick. |

The tier is computed from the rules, not stored, so it can never drift from what is
actually enabled. The active tier is shown on the HUD whenever it is not Arcade — an
easier run should never be able to quietly look like a real one.

### 6.7 Level size and the exit sequence

*(Both implemented, both from playtesting.)*

**Levels are 48×48 blocks, not 32×32.** At 32 a level is barely two screens across, which
is not a dungeon, it is a room: nowhere to hide anything, and a generator on the far side
is already on screen when you arrive. At 48 it is a bit over three screens each way.

The forty recipes are still written on a **32-unit design space** and mapped up at the
call site (`scaleOpts` in `tools/mkcampaign.mjs`). The rule that makes this work rather
than merely stretching: **regions scale, grain does not.** A lattice's step, a pillar
field's pitch, a corridor's width and a serpentine's gap all stay exactly as authored, so
a bigger grid gets *more* lattice, *more* pillars and *more* switchbacks — not bigger
ones. Scaling the grain too would give a level that is simply zoomed out: identical
content spread further apart, which plays worse than the small version, not better.

**The space between the features is now built.** The §11 vocabulary describes features —
a nest, a lattice, a gallery — and said nothing about what lies between them, so the answer
was quietly "nothing". Measured: 16% wall coverage of which 8.2% was the outer border, so
internal walls were about one tile in twelve. You could cross most levels in a straight
line without turning, where the original is a warren.

A recursive-division maze plus scattered rubble now runs *after* each recipe, taking wall
coverage to ~27%. Recursive division specifically, for one property: every wall it draws
is gapped before it recurses, so it cannot disconnect a level. Rubble can — a stub across
an alcove mouth seals it — so `connectPockets` floods from the start and knocks out the
single wall tile between any stranded pocket and reachable ground. Repairing beats backing
the density off, which would trade away the whole point for safety.

Walls stay ONE tile thick deliberately. Two-thick reads chunkier and more arcade, but the
diagonal cover rule (§8.2) depends on diagonally adjacent single blocks, and thick walls
would quietly delete the Elf and Wizard's signature move.

`protectedCells` keeps the structural pass off everything the recipe placed and out of
every doorway it carved, by finding chokepoints — open cells with walls on opposite sides —
before any new wall is drawn. Computing that as it went would be self-referential: the
growing wall line makes its own cells look like chokepoints.

**Generator density is targeted per SCREEN, not per level**, and getting that unit wrong
hid the problem through two rounds of playtesting. Off-screen generators are inert (§6.1),
so what a player experiences is how many sit inside the viewport — and a 48×48 level is
about nine screens. Eight generators over nine screens is 0.9 per screen: most screens
have none, and you walk through empty rooms between set pieces. Measured on the shipped
campaign at the time: **0.53 per screen at depth 1, 1.19 at depth 40**.

`genFloor` now derives the count from reachable area: about **2.2 generators per screen
early rising to 4.0 deep** (21 and 37 per level). Two placement bugs had to go with it:
`nest()` had a hard-coded list of six spots that silently capped every nest at six however
many a recipe asked for, and the top-up placed extras *furthest from the start*, which is
right for adding three and badly wrong for adding twenty — it packed everything into the
far end and left the whole starting region empty, so standing still on depth 1 and depth
20 for a full minute produced zero monsters. Placement is now greedy farthest-point
sampling over the reachable floor, seeded with whatever the recipe already built, so the
extras cover the map uniformly and avoid the nest. Intro levels are exempt from all of it.

Three tests hold this: per-screen density stays in a band computed from the *real* tuning
values (so the copies in the Node tooling cannot drift), every level has a generator
visible from the spawn point, and none is within three tiles of it.

**Food is halved relative to generator pressure**: ~0.42 pieces per screen, about 4 per
level, down from ~7.6. At the old rate the health drain never bit — food arrived faster
than 1/sec could burn it, so the clock that is meant to end a run was decorative.

Two independent floors keep that from going too far. The generator never emits fewer than
2 per level, because a level you cannot survive arriving at on low health is not
difficulty. And `RANK_MIN_FOOD_ITEMS` stops the rank curve culling below an absolute
count. That second one matters more than it looks: `RANK_MIN_FOOD_RATIO` is a
*proportion*, so halving the campaign's food silently halved the late-game floor with it —
a rich run on a 4-food level kept `ceil(4 x 0.15)` = one piece, which is not a difficulty
curve but a coin flip on whether you walk past it. Ratio sets the shape, the item count
sets the bottom.

Difficulty does **not** currently scale food; the ladder moves health cap, generator
warm-up, spawn period and crowd caps only.

**The exit sequence** (`T.EXIT_SEQUENCE_F`, 78 frames) is part of the **simulation**, not
the renderer. Reaching the exit starts it; `exitReached` — which is what the run flow
watches — only goes true at the end. During it the whole world is frozen: no monster
moves, no generator spawns, no drain ticks.

That placement is the whole design. The level is over the instant you touch the exit, and
a presentation-only version would have to either lie about that or let a ghost kill you
during your own victory animation. It also means the sequence is deterministic and
replayable like everything else.

What plays: the player is pulled to the exact centre of the exit tile, then wound down
into it — scaled about its **feet**, not its centre, because a figure shrinking toward its
middle looks deleted while one shrinking toward the ground looks pulled under. A portal
opens beneath, sparks fall *inward* (an outward burst reads as destruction; this is the
dungeon taking you somewhere), a column of light arrives late, and an iris closes on the
exit rather than on the middle of the screen — so the last thing visible is where you
went. The sound is a 1.05s layered sweep: two detuned saws gliding up through an opening
resonant filter, a sub-bass swell underneath, an arpeggio over the top, and filtered
noise. A single chime cannot carry an event this long, and the length is most of why the
original's exit is the part people remember.

### 6.8 Difficulty

*(Implemented.)* A five-rung ladder, and the setting that changes the game most, so it
sits at the top of the setup screen rather than buried under sixteen toggles. It lives in
`Rules`, which means it is captured in run state and replays and recorded on the score
table.

| | Max health | Generator warm-up | Spawn period | Crowd cap |
| --- | --- | --- | --- | --- |
| Apprentice | 2400 | 4.0 s | ×1.5 | ×0.6 |
| Squire | 1900 | 2.5 s | ×1.2 | ×0.8 |
| **Veteran** (default) | **1500** | 1.2 s | ×0.85 | ×1.0 |
| Champion | 1100 | 0.5 s | ×0.6 | ×1.35 |
| Nightmare | 800 | 0.0 s | ×0.4 | ×1.8 |

Three things worth stating plainly:

**The health cap is not a nerf, it is a mechanic.** The original capped health, and the
cap does real work: once you cannot bank any more, food you walk past is genuinely
wasted and the drain becomes a clock again rather than an accounting detail. Without one
a careful player simply accumulates until nothing on the level can threaten them, which
is exactly what playtesting found.

**The warm-up is spent once per generator, on first sighting** — not on every sighting.
A per-sighting timer would make peeking in and out of a doorway a free reset, which is a
worse game than either no warm-up or a long one.

**Veteran is 15% faster than the raw reconstruction** in `tuning.ts`, because the
reconstructed numbers were too slow to threaten anyone. The arcade values are still the
arcade values; this scales them, and the multiplier is written down rather than being
quietly folded into the constants.

Eligibility treats difficulty **asymmetrically**: playing above the default stays fully
Arcade-eligible, because playing harder is not a way to get an easier score, while
playing below it is Tagged. Treating both directions as "altered" would punish exactly
the players doing the hard thing. The score table shows the difficulty on every entry
regardless, since a Nightmare run sorted in among Apprentice runs with nothing to
distinguish them makes the table meaningless.

**The toggles.**

| Group | Toggle | Default | Tier if changed |
| --- | --- | --- | --- |
| Monsters | Ghosts, Grunts, Demons, Sorcerers, Lobbers | on | Ineligible |
| Monsters | **Death** | on | Ineligible |
| Monsters | **Thief** | on | Ineligible |
| Pressure | Health drain (1/sec) | on | Ineligible |
| Pressure | Rank curve (food starves as score climbs) | on | Ineligible |
| Pressure | Generators inert off-screen | on | Ineligible |
| Mechanics | Corner-squeeze cover rule | on | Tagged |
| Mechanics | Full inventory blocks movement | on | Tagged |
| Mechanics | Doors auto-open on the stalemate timer | on | Tagged |
| Mechanics | Walls become exits after 180 s | on | Tagged |
| Mechanics | Corner assist on movement | on | Tagged |
| Movement | Diagonals run at full speed per axis | on | Tagged |
| Input | Fire model, analog stick, rumble | §5.2/§5.3 | per §5.2 |

**Disabling a monster removes its generators.** A level whose centrepiece is a ghost nest
becomes a quiet room. The alternative — substituting another family — was rejected
because it silently rewrites the level designer's intent while appearing to respect it.
Removal is honest and visible.

**Presets**: *Arcade* (all defaults), *Modern* (the §4.8 softening: more health, gentler
rank curve, unlimited continues), *Sandbox* (a scratchpad for experimenting), and
*Custom* whenever the player edits anything.

**Rules are part of the simulation**, not of presentation: they are captured in the run
state and in replays, so a recorded run replays under the rules it was played with.

## 7. Technical architecture

### 7.1 Stack

- **TypeScript**, strict mode. **Vite** for dev server and build.
- **Canvas 2D**. No WebGL — one playfield blit, a few hundred `drawImage` calls, one half-res
  light pass; 2D is sufficient and far simpler. Behind a `Renderer` interface regardless.
- **Zero runtime dependencies.** Dev deps only: Vite, TypeScript, Vitest, ESLint.
- Output is a static bundle: `index.html`, one JS file, PNG sprite atlases, one webfont.

Why not a game framework (Phaser/Excalibur/Kaboom): the whole point is exact control over the
fixed-step loop, collision resolution at pixel granularity, and determinism. A framework's
scene graph, tweening, and physics would be fought, not used.

### 7.2 Directory layout

```
/index.html
/src
  main.ts                  bootstrap, screen state machine
  /engine
    loop.ts                fixed-timestep accumulator
    input.ts               merges keyboard+gamepad into one ActionState, binding map, edges
    keyboard.ts            key state, event.code handling, rollover test
    gamepad.ts             polling, deadzone+hysteresis, 8-way quantise, device profiles, rumble
    display.ts             canvas sizing, A/S scale resolution, letterbox, CRT overlay
    audio.ts               Web Audio graph + synth voices
    speech.ts              speechSynthesis wrapper + captions
    rng.ts                 seeded xorshift128
    grid.ts                tile queries, ray/AABB vs grid
    spatial.ts             uniform-grid broadphase
    pool.ts                entity pooling
  /game
    world.ts               the simulation: entity arrays, step()
    player.ts              movement, firing, melee, inventory, damage
    monster.ts             per-type update, shared chase logic
    ai.ts                  chase / flee / lob-lead / wander helpers
    generator.ts           spawn timers, on-screen gating, damage
    projectile.ts          player shots, fireballs, rocks
    magic.ts               potion detonation resolution
    items.ts               pickups, breakables
    terrain.ts             doors, breakable walls, trap tiles, teleporters, wall->exit timer
    camera.ts
    combat.ts              damage application, armor, death, scoring hooks
    score.ts               score, rank curve, credits
    level.ts               load/instantiate a level, rank-based food culling
    flow.ts                level progression, intro-level skip exits, treasure rooms
    events.ts              typed event bus (sim -> audio/announcer/render, one direction)
  /render
    renderer.ts            the Renderer interface (canvas2d impl today)
    tilemap.ts             autotiled full-level offscreen cache + dirty blocks
    sprites.ts             atlas loading, frame lookup, palette-swap ramps
    lighting.ts            half-res light buffer + composite
    particles.ts           pooled emitters
    hud.ts
    fx.ts                  explosions, flashes, screen shake, hit-stop
    text.ts                webfont HUD text + pixel font for in-world text
  /data
    tuning.ts              THE tuning table (§10) - single source of truth
    classes.ts             the four classes
    monsters.ts            monster definitions
    palette.ts
    /art                   pixel data modules
    /levels                *.json
    campaign.ts            level order, themes, upgrade-potion placement
  /ui
    attract.ts charselect.ts levelintro.ts gameover.ts options.ts highscores.ts
/tools/editor              browser level editor (separate Vite entry, editor.html)
/tests                     Vitest unit tests + replay fixtures
```

### 7.3 The loop

```ts
const STEP = 1 / 60;
let acc = 0, prev = performance.now();

function frame(now: number) {
  requestAnimationFrame(frame);
  acc += Math.min((now - prev) / 1000, 0.25);   // clamp after tab-switch
  prev = now;

  input.poll();                                 // ONE gamepad poll per rendered frame;
                                                // reused by every step below (determinism)
  let steps = 0;
  while (acc >= STEP && steps++ < 5) {          // never spiral
    const actions = input.sample();             // ActionState; edges fire on first step only
    screen.step(actions);                       // pure simulation, no rendering
    acc -= STEP;
  }
  screen.draw();                                // reads state, writes pixels, mutates nothing
  display.present();
}
```

`input.sample()` reports `firePressed`/`magicPressed` edges on the first step of a frame only, so
a single button press can never trigger twice when the loop catches up on two steps.

Hard rule: **`step()` never touches the canvas, `draw()` never mutates simulation state.**
That rule is what makes headless replay testing possible (§13).

### 7.4 Entity model

Not a general ECS — a small fixed set of typed arrays, which keeps determinism and iteration
order trivial:

```ts
interface World {
  tiles: Uint8Array;           // 32*32 terrain
  tileState: Uint8Array;       // door-open, wall-destroyed, trap-triggered flags
  player: Player;              // exactly one
  monsters: Monster[];         // pooled, level-capped
  generators: Generator[];
  projectiles: Projectile[];   // player shots, fireballs, rocks
  items: Item[];               // food, keys, potions, treasure
  fx: Effect[];                // render-only, still stepped deterministically
  rng: Rng;
  frame: number;
}
```

Update order per step (fixed, documented, because it is observable):

1. input → player intent
2. player movement & collision
3. player fire / melee
4. projectiles
5. monsters (in stable array order)
6. generators
7. terrain timers (doors, wall→exit, traps, teleport cooldowns)
8. pickups & overlaps
9. damage resolution & deaths
10. health drain tick (every 60th frame)
11. score/rank, level-exit check
12. fx

### 7.5 Coordinates

- World is **768×768 world units (wu)**, `48×48` blocks of `16 wu`. All positions are floats in wu.
  **Nothing in `src/game/` ever refers to a screen pixel** — that conversion happens only in
  `src/render/`, which multiplies by `A·S`. This is what lets the art scale change freely.
- Entity collision boxes are AABBs centred on position:
  player `12×12`, monsters `12×12`, Death `14×14`, items `16×16`,
  shots `2/6/12` square depending on the class's shot collision box (§8.3).
- Camera is a 232×240 wu window over the world, clamped to bounds.

---

## 8. Core systems in detail

### 8.1 Movement and wall collision

Axis-separated with slide, plus **corner assist**, which is essential to the feel — Gauntlet lets
you round corners without pixel-perfect alignment:

```
moveAxis(entity, dx, 0):
  target = pos.x + dx
  if AABB at (target, pos.y) overlaps a solid tile:
      # corner assist: if only one corner is blocked and the entity is within
      # CORNER_ASSIST px of clearing it, nudge perpendicular instead of stopping
      if canNudge(perpendicular) -> pos.y += sign * min(CORNER_ASSIST_SPEED, overlap)
      else pos.x = snapped edge
  else pos.x = target
```

`CORNER_ASSIST = 5 px`, `CORNER_ASSIST_SPEED = 0.5 px/frame` **[inferred]** — tune against video.

Monsters use the same routine, so they also jam at corners, which is what produces the
traffic-jam tactic. Monster–monster overlap is **blocking**, resolved by the same slide code with
a small separation impulse to prevent lockups.

### 8.2 The diagonal-corner shot rule

> **Corrected during M1.** The v2 description of this rule was geometrically wrong. It claimed an
> *orthogonal* shot could thread the seam between two diagonally adjacent blocks. It cannot: a
> shot travelling east along the boundary between rows 0 and 1 is stopped by whichever of the two
> blocks occupies the cell it is entering, regardless of its size. The trick only works for a
> **diagonal** shot passing through the corner point the two blocks share — which means shots are
> **8-directional**, matching the 8-way facing. Implemented and tested as follows.

- Wall tests use the projectile's **centre cell**, stepped in sub-tile increments so a cell is
  never skipped. Size therefore does not act through raw overlap.
- On a **diagonal cell transition**, the two flanking cells are examined. If *both* are solid, the
  shot is threading the corner where two diagonally adjacent blocks meet, and passes only if
  `half <= CORNER_SQUEEZE_MAX` (3). Small (Elf) and Medium (Valkyrie, Wizard) pass; Large
  (Warrior) does not. Monsters, moving by full AABB, never can.
- If only one flank is solid the shot is merely clipping a corner with open floor beyond, and
  passes at any size.
- **Reachability is checked separately from overlap.** A shot stopped against a wall still sits
  within its own hit radius of a target in the diagonally adjacent cell — combined half-extents
  reach ~14 wu, most of a tile. Without a guard, a Large shot damages a generator straight through
  the corner that just blocked it, silently erasing the whole mechanic. `projectileCanReach()`
  applies the same corner rule to hit tests. This was a real bug caught by the M1 acceptance test.
- Shot velocity is normalised, so a diagonal shot is not 1.41× faster than an orthogonal one.

The proving level places a generator at (25,5) where the only straight line to it threads the
corner between blocks (24,5) and (25,6) — the acceptance test fires from (22,8) and asserts all
four classes land on the right side of the rule.

Flag for validation (§13): `CORNER_SQUEEZE_MAX` and the `SHOT_HALF` values are our reconstruction.

### 8.3 Firing

- One player shot alive at a time. `fire` held → refire the instant the previous shot dies.
- Shot direction = current facing (or `aim` in twin-stick mode). Facing changes when moving,
  freely while `face-lock` is held, and **also while immobilised by firing**.
- Movement suppression follows `fireModel` (§5.2): Arcade suppresses whenever `fire` is held;
  Feathered suppresses only after the press has been held ≥ `FIRE_FEATHER_FRAMES`; Free-fire and
  Twin-stick never suppress. Suppression gates *translation only* and is released on the same
  step the button comes up.
- Shot velocity = `shotSpeed × SHOT_SPEED_UNIT` px/frame, `SHOT_SPEED_UNIT = 1.0` **[inferred]**
  (so Warrior 2 px/f … Wizard/Elf upgraded 5 px/f).
- Shots damage: monsters (`shotStrength` HP), generators (`shotStrength` HP), breakable walls,
  breakable food jugs, blue potions (triggers a weak detonation), Death (1 pt + cycles its value).
- Shots are **stopped** by keys on the floor? No — keys are shoot-through but monster-blocking.
  Treasure and walls stop shots; treasure is shoot-*through* at diagonal seams like walls.

### 8.4 Melee

Walking into a monster with a non-zero relative velocity triggers a melee swing on an ~8-frame
cadence. **This gate is load-bearing, not decorative:** implemented without it (proximity alone),
a stationary player silently kills anything that wanders adjacent — which trivialises the game and,
in M1 testing, quietly ate every monster the generators produced, making them look broken. Melee
requires live movement *input* rather than actual displacement, so it still works when you are
pressed against a monster and cannot move; and it is suppressed while the fire model has you
rooted, since you cannot shoulder forward and stand still at once. Wider hit arc than a shot (a `20×12` box in the facing direction), which is why melee is
the escape tool when surrounded. Cannot hit ghosts (they self-destruct on contact first). Against
generators it does a flat 1 HP with a per-class miss chance (Wizard/Elf always miss).

### 8.5 Magic (potions)

```
detonate(user, source):        # source = USED | SHOT
  strengthMon = user.magicVsMonsters[source]
  strengthGen = user.magicVsGenerators[source]
  for each monster within the *playfield viewport*:
      if monster is Death: kill, award cycled value
      else damage(monster, strengthMon)
  for each generator within the viewport:
      if it is a block-generator and user is Valkyrie: damage +1
      damage(generator, strengthGen)
  flash screen white for 6 frames, shake, big sfx
```

Viewport-scoped, not level-scoped — the "smart bomb clears the screen" behaviour. This is another
reason the 232×240 window must stay faithful.

### 8.6 Monster AI

Shared chase step, per-frame:

```
chase(m, target):
  dx = target.x - m.x; dy = target.y - m.y
  want = (sign(dx), sign(dy))                    # 8-way
  if !tryMove(m, want): 
     if !tryMove(m, (want.x, 0)):
        tryMove(m, (0, want.y))
```

The zig-zag emerges from `sign()` flipping as the monster overshoots on the minor axis at
sub-pixel speeds — matching the described behaviour without a special case.

Per type:

- **Ghost** — chase, on contact deal `10×level` damage and destroy self. Immune to melee.
- **Grunt** — chase; within melee range, attack every `ATTACK_PERIOD` frames.
- **Sorcerer** — grunt + visibility cycle (`visible 90 f / invisible 60 f` **[inferred]**);
  while invisible, shots pass through and it is drawn at ~25% alpha with a shimmer.
- **Demon** — grunt + ranged: if `|dx| < 8` or `|dy| < 8` px and within `RANGE`, fire a fireball
  along that axis on a cooldown, **ignoring line of sight**. Fireball does 10 flat, destroys
  breakables, damages generators and other monsters.
- **Lobber** — if distance < 3 blocks, flee (chase with inverted sign). Otherwise lob a rock on a
  cooldown at the player's **predicted** position (`pos + vel × flightTime`, no wall check).
  Rocks arc over walls (rendered with a parabolic z-offset; collision ignores walls mid-flight),
  land, and damage anything at the landing tile. 3 damage flat. Rocks *destroy* bone generators.
- **Death** — slow constant chase, ignores walls? **No** — it walks the maze like everyone else,
  it is merely unkillable. On contact, drain `DEATH_DRAIN_PER_FRAME` until contact breaks or it
  has taken 200 total, then it vanishes. Ignores armor entirely.
- **Thief** — very fast chase; on contact steals (upgrade > potion > key > 500 score, in that
  order), then paths to the nearest exit and despawns. On death drops a jewel bag and restores
  what was stolen (upgrade → plain potion, per the original).

### 8.7 Generators

```
step(g):
  if !onScreen(g, camera, MARGIN): return          # off-screen generators are inert
  if world.monsterCount >= MONSTER_CAP_TOTAL: return
  if localMonsterCount(g, 3 blocks) >= LOCAL_CAP: return
  g.timer -= 1
  if g.timer <= 0:
      slot = pick a free tile among the 8 neighbours (deterministic order, rng tiebreak)
      if slot: spawn monster of (g.type, g.level); g.timer = spawnPeriod(g.level, dungeonLevel)
```

`spawnPeriod` decreases with dungeon depth and with generator level. Damage reduces `g.level`
(and therefore the level of future spawns); at 0 the generator is destroyed with an explosion.

### 8.8 Doors, walls, and timers

- `engagementTimer` resets whenever the player fires, is hit, deals damage, or picks anything up.
  At **18 s** (or **36 s** if the player holds ≥1 key) all doors in the level open.
- `stillnessTimer` counts frames where the player has zero movement input (firing and turning are
  allowed). At **180 s** every wall block converts to an exit. On any movement, reset to 0.
- Trap tiles: on step, apply the level's scripted `openWalls` list for that trap.
- Teleporters: on entry, find the nearest other teleporter by path-agnostic distance; with
  multiple candidates, choose `floor(elapsedSeconds) % candidates.length` (faithful to the
  original's wall-clock quirk, and deterministic because we use the sim clock). Exit tile is
  chosen by the direction the player is holding. 30-frame cooldown to prevent ping-pong.

### 8.9 Rank system

```
foodKeepRatio = clamp(1 - score / 300_000, 0.15, 1)
```

Applied at level load: sort food items by a stable hash of `(levelId, x, y)`, keep the first
`ceil(count × foodKeepRatio)`. Deterministic, and it degrades smoothly rather than in cliffs.
Health-relevant, so it is the difficulty curve.

### 8.10 Rendering

- The full level is pre-rendered once to an offscreen canvas. Tile changes (door opened,
  wall destroyed, wall→exit conversion) mark 16×16 dirty rects, redrawn in place.
- Each frame: blit the camera rect, then draw entities sorted by `y` (so sprites overlap
  correctly), then projectiles, then fx, then the HUD panel, then captions/overlays.
- Sprites are drawn from a single baked atlas canvas; palette-swapped variants (monster levels)
  are baked as separate atlas rows at startup.
- Expected cost: one 232×240 blit + ~150 small blits per frame. Trivially 60 fps.

---

## 9. Data formats

### 9.1 Level file (`src/data/levels/*.json`)

```jsonc
{
  "id": "d012",
  "name": "The Cistern",
  "theme": "stone",
  "type": "normal",            // normal | intro | treasure
  "start": [3, 28],
  "tiles": [                   // 32 strings of 32 chars
    "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "X..............X...............X",
    // ...
  ],
  "objects": [
    { "t": "gen",   "x": 12, "y": 7,  "kind": "ghost",  "lvl": 3 },
    { "t": "gen",   "x": 20, "y": 7,  "kind": "grunt",  "lvl": 2 },
    { "t": "mon",   "x": 4,  "y": 4,  "kind": "lobber", "lvl": 1 },
    { "t": "death", "x": 26, "y": 26 },
    { "t": "food",  "x": 9,  "y": 3,  "breakable": true },
    { "t": "key",   "x": 5,  "y": 12 },
    { "t": "potion","x": 18, "y": 22 },
    { "t": "upgrade","x": 30,"y": 2,  "kind": "speed" },
    { "t": "treasure","x": 14,"y": 15 },
    { "t": "trap",  "x": 7,  "y": 19, "opens": [[10,19],[11,19],[12,19]] },
    { "t": "tele",  "x": 2,  "y": 2 },
    { "t": "exit",  "x": 31, "y": 16, "skipTo": null }
  ]
}
```

Tile glyphs: `.` floor, `X` wall, `x` breakable wall, `D` door, `E` exit, `@` teleporter pad,
`^` trap floor, ` ` void (solid, unrendered).

Objects are kept out of the tile layer because most carry parameters. The editor round-trips
this format exactly.

### 9.2 Campaign (`src/data/campaign.ts`)

```ts
export const campaign = {
  intro: ["i01","i02","i03","i04","i05","i06","i07"],   // numbered skip exits
  loop:  ["d001", ... "d100"],                           // repeats forever
  treasureRoomEvery: 12,                                 // insert a treasure room
  upgradeLevels: { 3: "shotpower", 9: "speed", 14: "magic", ... },
};
```

### 9.3 Save / high scores (`localStorage`)

```ts
{ version: 1,
  scores: [{ initials, score, credits, scorePerCredit, deepestLevel, cls, coldStart, date }],
  settings: {
    keyBindings, padBindings, padProfiles,   // padProfiles keyed by gamepad.id
    preset, fireModel, analogMovement, rumble,
    artScale, screenScale, widescreen, crt, colourBlindPalette,
    audio, speech,
  },
  resume?: { levelIndex, cls, score, health, inventory, upgrades, credits, rngSeed }
}
```

---

## 10. Tuning constants

Everything gameplay-numeric lives in `src/data/tuning.ts`. Nothing else in the codebase may hold
a magic gameplay number. Marked **[i]** = inferred, needs validation against reference video.

```ts
export const T = {
  // --- world space (wu). Never change these. ---
  TILE: 16, GRID: 48, WORLD: 768,
  VIEW_W: 232, VIEW_H: 240,          // gameplay viewport, LOCKED (see 6.1)
  STEP_HZ: 60,

  // --- presentation only; safe to change, no gameplay effect ---
  ART_SCALE: 2,                      // px per wu (32px art per 16wu block)
  SCREEN_SCALE_RANGE: [1, 3],

  // --- input ---
  FIRE_FEATHER_FRAMES: 6,            // Feathered fire model grace window
  PAD_DEADZONE: 0.35,
  PAD_HYSTERESIS: 0.10,
  PAD_TRIGGER_THRESHOLD: 0.5,

  START_HEALTH: 700,
  CONTINUE_HEALTH: 700,
  HEALTH_DRAIN_PER_SEC: 1,
  FOOD_HEALTH: 100,
  LOW_HEALTH_WARN: 200,
  CRITICAL_HEALTH: 100,

  INVENTORY_SLOTS: 12,

  SPEED_UNIT: 0.5,          // [i] px/frame per point of the 1..5 speed stat
  SHOT_SPEED_UNIT: 1.0,     // [i] px/frame per point of the 1..5 shot-speed stat
  SHOT_HALF: { small: 1, medium: 3, large: 6 },   // [i] px

  CORNER_ASSIST: 5,         // [i] px
  CORNER_ASSIST_SPEED: 0.5, // [i] px/frame

  MELEE_PERIOD: 8,          // frames [i]
  MELEE_BOX: [20, 12],      // [i]
  MONSTER_ATTACK_PERIOD: 20,// frames [i]

  GHOST_DMG:   [10, 20, 30],
  MELEE_DMG:   [5, 8, 10],   // grunt/demon/sorcerer contact
  FIREBALL_DMG: 10,
  ROCK_DMG: 3,
  THIEF_DMG: 10,
  DEATH_TOTAL_DRAIN: 200,
  DEATH_DRAIN_PER_FRAME: 4,  // [i] ~50 hp/sec while in contact

  MONSTER_HP_BY_LEVEL: [1, 2, 3],   // [i]
  GEN_HP_BY_LEVEL:     [1, 2, 3],

  MONSTER_CAP_TOTAL: 90,     // [i]
  MONSTER_CAP_LOCAL: 6,      // [i] within 3 blocks of a generator
  GEN_OFFSCREEN_MARGIN: 8,   // px [i]
  GEN_PERIOD_BASE: [150, 110, 75],  // frames by generator level [i]
  GEN_PERIOD_DEPTH_SCALE: 0.995,    // per dungeon level [i]

  DOOR_AUTO_OPEN_SEC: 18,
  DOOR_AUTO_OPEN_SEC_WITH_KEYS: 36,
  WALLS_BECOME_EXITS_SEC: 180,

  INVISIBILITY_SEC: 20,
  SORCERER_VISIBLE_F: 90, SORCERER_INVISIBLE_F: 60,   // [i]
  LOBBER_FLEE_BLOCKS: 3, LOBBER_COOLDOWN_F: 90,       // [i]
  DEMON_FIRE_COOLDOWN_F: 75, DEMON_RANGE_PX: 160,     // [i]
  TELEPORT_COOLDOWN_F: 30,

  SCORE: {
    ghostPerLevel: 10, monsterPerLevel: 5,
    meleeKill: 25, magicKill: 10,
    generatorPerLevel: 50,        // [i]
    food: 100, key: 100, treasure: 100,
    jewelBag: 500, thiefShot: 500,
    deathShot: 1,
    deathPotionCycle: [1000, 2000, 1000, 4000, 2000, 6000, 8000],
    treasureRoomPerTreasure: 50,
  },

  RANK_ZERO_FOOD_SCORE: 300_000,
  RANK_MIN_FOOD_RATIO: 0.15,
};
```

---

## 11. Content plan

The original's 100+ mazes are Atari's; we author our own. To stay true to the *design language*,
levels are built from a documented vocabulary:

| Pattern | Purpose |
| --- | --- |
| **Generator nest** | 3–8 generators packed behind a chokepoint; the level's centrepiece problem. |
| **Key/door flood control** | Hordes penned behind doors so the player chooses when to open them. |
| **Cover lattice** | Diagonally-offset wall/treasure blocks that let small-shot classes snipe safely — the Elf/Wizard reward. |
| **Lobber gallery** | Lobbers behind an impassable wall, forcing you to train their rocks onto generators. |
| **Death corridor** | 1–3 Deaths on the only route; a potion tax, or a dodging test. |
| **Food gauntlet** | Food behind a damage cost — the payoff must be tuned against the rank curve. |
| **Treasure vault** | Optional greed detour, which *raises* your rank and thins future food. |

Shipping content:

- **7 intro levels**, the last of which is the level-select: **six labelled doors** to
  depths 8, 14, 20, 26, 32 and 38, each with its destination painted on the vestibule
  floor. Three doors reaching only depth 16 left the back half of the campaign
  unreachable without playing through to it, and an unlabelled door asks you to gamble on
  a number you cannot see, which is not a choice.
- **40 hand-authored dungeon levels**, themed in blocks of 8.
- **Treasure rooms** every 12 levels: a timed room (30 s) packed with treasure.

  **You only keep what you carry out.** Pickups do not score as you take them — their value
  is escrowed and paid, with a `50 × treasures` bonus on top, if and only if you reach the
  exit before the clock stops. Let it run out and you leave with nothing.

  This is the entire point of the room and it was missing: paying out on expiry as well
  made the exit decorative, because there was no reason to ever stop hoovering. Greed has
  to be able to cost you something, and the tension only exists if the last piece you reach
  for can be the one that loses you the lot.

  The countdown is drawn large across the top of the playfield — green, then amber, then a
  pulsing red under five seconds — and states the haul at risk in points, because that
  number is the argument for leaving. An invisible timer would have been indefensible even
  before the forfeit rule; with it, it would be a trap.
- **Endless loop** past 40: replay the 40 with a depth multiplier applied to generator rates and
  generator levels, so it genuinely gets harder, matching the original's loop-forever structure.
- A **browser level editor** (`/tools/editor`, served as `editor.html`) — paint tiles, place
  objects, playtest in place, export the JSON. This is the difference between shipping 40 good
  levels and 12 mediocre ones, so it is a milestone, not a stretch goal.

### 11.1 The editor

*(Implemented. `npm run dev` then open `/editor.html`.)*

The editor exists for one reason: **feedback latency**. The gap between a good level and a
mediocre one is how quickly the author finds out that a room is sealed, an item is buried, or
the exit cannot be reached. So:

- **Validation runs on every single edit** and its verdict is always on screen. You never have
  to ask whether the level is broken.
- **Unreachable floor is tinted red** directly on the grid. Sealed rooms are visible rather than
  discovered.
- **Playtest opens the real game**, not a preview of it, with the edited level as a
  one-level campaign. Anything that behaves differently in the editor's preview than in the game
  is a lie the author will believe, so there is no preview.

**Random generation.** Six archetypes — Warren, Cover field, Key vault, Serpentine,
Pillar hall, Death run — parameterised by depth and seed (`tools/levelgen.mjs`). Same
type + depth + seed always yields the same level, which is what makes a seed worth showing
the user: find one you like, note the number, get it back.

It shares `levelkit.mjs` with the campaign generator rather than reimplementing the
patterns, so a fix to `nest()` reaches the editor and the shipped campaign at once, and
the density floors live in the kit for the same reason — two copies of "how much should a
level hold" drift, and the units are subtle enough to get wrong twice.

Randomness varies *where* and *how much*, never *what the level is about*. Each type is a
kind of problem; a level that could be anything is a level about nothing. And every
generated level is re-checked for reachability at the end, with a corridor carved from the
start to anything stranded, because a generator that can emit an unplayable level is one
you cannot trust — "usually fine" is not a property worth having.

The verdict comes from `analyseLevel()` in `src/game/analyse.ts`, which is the *same* function a
test runs over every shipped level. This matters more than it looks: an editor that blesses a
level CI later rejects is worse than no editor, because it teaches the author to trust it. One
definition of "playable", used by both.

`analyseLevel` fires traps rather than exempting them — a vault opened by a pressure plate is
reachable, and it proves this by simulating the plate, re-flooding, and repeating until nothing
new opens. The alternative (an "sealed by design" exemption) was tried, and it hid a genuinely
sealed vault with eighteen treasures and an upgrade behind it for an entire milestone.

Handoff to the game is via `localStorage` plus a `?playtest` marker in the URL. The marker is
what decides: without it the stored level is ignored entirely, so a stale handoff can never
hijack an ordinary game. The level is re-validated on the way in — the editor is a tool, not a
trusted source.

---

## 12. Implementation milestones

Each milestone ends with a playable build and explicit acceptance criteria.

### M0 — Skeleton (est. 2–3 days)

Vite/TS project, fixed-step loop, display with `A`/`S` scale resolution, **keyboard *and* gamepad
input reduced to `ActionState`** (deadzone, hysteresis, 8-way quantisation, hot-plug), level JSON
loader, tilemap render with autotiling, player movement + wall collision + corner assist, camera.

*Accept:* Elf walks a hand-made test maze at 60 fps on both a keyboard and a gamepad; diagonals
don't chatter at the stick's deadzone edge; unplugging the pad mid-run falls back to keyboard
without a hitch; camera clamps at edges.

### M1 — Combat core (2–3 days)

Shots (one-at-a-time, class collision box, diagonal-seam rule), **all four fire models**, melee,
grunts + ghosts, generators with off-screen gating, HP/damage/armor, health drain, death,
basic HUD numbers.

*Accept:* a generator nest produces a real threat; you can kill a level-3 generator with a
Warrior but not with a Warrior's magic; ghosts hurt notably more than grunts; shooting the seam
between two diagonal walls works as an Elf and fails as a Warrior. **Fire-model playtest gate:**
play the same level in Arcade and Feathered on both keyboard and pad, and pick the per-device
defaults from that, not from this document.

### M2 — Items, terrain, level flow (2–3 days)

Food/key/potion/treasure, 12-slot inventory, doors + key use + auto-open timers, exits, level
progression, breakable walls, trap tiles, teleporters, wall→exit timer, potion detonation,
scoring, rank curve.

*Accept:* a full 5-level run is playable start to finish; every timer in §8.8 verified by stopwatch.

### M3 — Full monster roster (2–3 days)

Demon, sorcerer, lobber (arcing rocks with lead prediction, over-wall), Death (drain + potion
cycle + score cycling), Thief (steal/flee/recover). Monster-on-monster and projectile-on-item
destruction.

*Accept:* lobber rocks can be trained onto a bone generator and destroy it; a demon lined up
behind a generator damages it; Death shot 6× then potioned scores 8000; the thief steals an
upgrade and returns it as a plain potion when killed.

### M4 — Presentation (5–7 days)

Full 32×32 sprite/tile art with 8 facings, autotiled wall sets across 6 themes, lighting pass,
particles, screen effects, the flanked HUD layout, character select with stat bars, level intro
screens, attract mode, game over + initials, Web Audio synth SFX, announcer + captions, options
screen with **keyboard and gamepad rebinding** (including the press-the-control detection flow for
non-standard pads), rumble toggle, CRT overlay.

*Accept:* silent play is fully legible; every announcer trigger fires correctly; all bindings on
both devices remappable and persisted; an arcade stick that reports a non-standard mapping can be
fully bound through the detection flow; `prefers-reduced-motion` disables shake, flash and hit-stop.

(Longer than v1's estimate — the art upgrade is most of the added cost, and it's the right place
to spend it.)

### M5 — Content and editor (4–6 days)

Level editor, 7 intro levels, 40 dungeon levels, treasure rooms, campaign loop with depth scaling,
upgrade-potion placement.

*Accept:* a cold-start Arcade-preset run of levels 1–20 is beatable by a skilled player on one
credit, and brutal on level 30+.

### M6 — Polish (2–3 days)

Continues and score-per-credit, local high-score table, save/resume, difficulty presets, pause,
performance pass, colour-blind-safe class palette option, widescreen toggle with its deviation
warning, README + controls card (keyboard and pad).

*Accept:* no dropped frames on a 5-year-old laptop at `S=2`; a run survives a page reload; all §4
adaptations and §5.2 fire models implemented and documented in-game under About.

**Rough total: 4–5 weeks of focused work**, of which roughly half is content and art.

---

## 13. Testing and fidelity validation

**Unit tests (Vitest)**

- Grid/AABB collision, including the diagonal-seam cases for each shot size.
- `chase()` zig-zag output for known geometries.
- Armor/damage arithmetic per class per monster level.
- Death potion-value cycle, rank curve, inventory overflow (12 slots, can't walk through a key
  you can't pick up).
- Level JSON parse/validate — a schema check that runs over every shipped level in CI.
- **Input reduction**: axis values → quantised 8-way direction across the deadzone/hysteresis
  boundary (no chatter, no missed diagonals); button edges fire exactly once when a frame runs
  two simulation steps; each fire model's suppression window, including same-step release.
- **No screen units in the simulation**: a lint rule plus a test asserting that changing
  `ART_SCALE` leaves a golden replay bit-identical. This is the guard that keeps the graphics
  upgrade from quietly becoming a gameplay change.

**Deterministic replay harness**

Because `step()` is pure and the RNG is seeded, a run is `(seed, levelId, class, input[])`.
The harness runs it headless in Node and asserts final score/health/frame-of-death. Recorded
replays double as regression tests: any change to movement or AI that shifts a golden replay is
flagged for human review, not silently accepted.

**Fidelity validation against the original**

The `[i]` constants in §10 are reconstructions. Validate by capturing MAME video of the arcade
ROM at a known revision and measuring:

1. Blocks crossed per second per class (→ `SPEED_UNIT`).
2. Frames for a shot to cross the screen per class (→ `SHOT_SPEED_UNIT`).
3. Shots to destroy a level-3 generator per class (→ shot strength/HP model).
4. Health lost per second while a ghost stream is on you (→ attack cadence).
5. Health lost while touching Death (→ `DEATH_DRAIN_PER_FRAME`).
6. Time from generator spawn to next spawn at each level (→ `GEN_PERIOD_BASE`).
7. **Whether holding Fire stops the character completely or merely slows it**, and whether facing
   still updates while held (→ the Arcade fire model). This comes from a strategy guide rather
   than a measurement, and it is the assumption most likely to be wrong.

Record measured vs. implemented in a `docs/fidelity.md` table so deviations are explicit rather
than accidental.

---

## 14. Risks and open questions

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Original maze layouts are the heart of the game and we're not using them | Medium — content quality risk | Level editor early (M5), documented design vocabulary (§11), playtesting gates |
| `[i]` constants make the game feel *nearly* but not quite right | High — this is the whole point | The §13 measurement pass is mandatory, not optional; every number lives in one file so retuning is cheap |
| `speechSynthesis` voice quality/availability varies wildly by browser and OS | Low | Captions always on-screen; speech is enhancement only; ship a "no speech" default if a voice probe fails |
| Audio autoplay blocked until user gesture | Low | Resume `AudioContext` on first keypress; title screen requires a keypress anyway |
| Keyboard ghosting on cheap keyboards with 3 keys held | Low–Medium | Defaults chosen for matrix safety; rollover tester in Options; full rebinding; **a gamepad sidesteps it entirely and is now a first-class path** |
| Gamepad mapping variance — arcade sticks and older pads report non-standard layouts and odd hat axes | Medium | Press-the-control detection flow accepting any button/axis/hat; per-device-id profiles; standard mapping as the happy path |
| Analog stick makes movement easier than a digital cabinet stick did | Medium | 8-way quantisation by default; 360° analog is an opt-in labelled deviation |
| Scope creep into Gauntlet II features | Medium | Explicit non-goals (§1) |
| **Art volume grew with the upgrade** (32×32, 8 facings, 6-frame walks, 47-piece autotile sets × 6 themes) | **High — now the largest single cost** | Palette-swap monster levels rather than redraw; generate the 47-piece blob sets from a small hand-drawn source set; build the autotiler before drawing any theme so a theme is ~12 source tiles, not 47; cut to 4 themes if M4 slips |
| Graphics upgrade silently becomes a gameplay change (wider view, different collision) | High | World units vs. pixels separated by construction (§6.1, §7.5); enforced by the `ART_SCALE`-invariance replay test (§13) |

**Open questions to settle before M1:**

1. **Per-device fire-model defaults.** Proposed: Arcade on gamepad, Feathered on keyboard. This is
   a feel judgement that no amount of writing settles — M1 ends with a playtest gate specifically
   for it, on both devices.
2. Whether the endless loop should reuse the 40 levels or generate levels procedurally past 40.
   Recommendation: reuse with depth scaling (predictable, testable); revisit only if it gets stale.
3. `ART_SCALE = 2` vs `3`. 2× is the recommendation — it is a clear upgrade, and 3× roughly
   doubles the art hours for a difference most players won't name. Revisit only if art comes in
   faster than expected.

---

## 15. Sources

Primary research used for the fidelity tables above:

- [StrategyWiki — Gauntlet/Gameplay](https://strategywiki.org/wiki/Gauntlet/Gameplay) — 700 starting
  health, 1 hp/sec drain, door auto-open timers (18 s / 36 s), 180 s wall→exit, ranking system.
- [StrategyWiki — Gauntlet/Statistics](https://strategywiki.org/wiki/Gauntlet/Statistics) — the
  per-class stat tables, explicitly noted as measured from the arcade final revision rather than
  copied from a manual.
- [StrategyWiki — Gauntlet/Enemies](https://strategywiki.org/wiki/Gauntlet/Enemies) — monster damage
  values, generator families and HP-equals-level rule, Death's drain cap and potion-value cycle,
  thief behaviour.
- [StrategyWiki — Gauntlet/Items and dungeon parts](https://strategywiki.org/wiki/Gauntlet/Items_and_dungeon_parts) —
  inventory slots, upgrade potions, teleporter rule, trap tiles, invisibility.
- [StrategyWiki — Gauntlet/Strategy](https://strategywiki.org/wiki/Gauntlet/Strategy) and
  [Secrets](https://strategywiki.org/wiki/Gauntlet/Secrets) — generator tactics, off-screen
  generator behaviour, wall→exit trick.
- [MAME `src/mame/atari/gauntlet.cpp`](https://github.com/mamedev/mame/blob/master/src/mame/atari/gauntlet.cpp) —
  336×240 visible area, 64×64 8×8 playfield tilemap, ~59.92 Hz, 68010 + TMS5220C.
- [Wikipedia — Gauntlet (1985 video game)](https://en.wikipedia.org/wiki/Gauntlet_(1985_video_game)) —
  overview, speech chip and narrator, credit/score-division rule.
- [Jake Gordon — Javascript Gauntlet: Level Maps](https://jakesgordon.com/writing/javascript-gauntlet-maps/) —
  a prior browser reimplementation; useful as a sanity check on level representation approaches.
- Native-resolution arcade screenshot (336×240) used to derive the HUD panel geometry and the
  `1 COIN = 700 HEALTH` footer.

---

*Bracer is an unaffiliated homage. "Gauntlet" is a trademark of its respective owner; this project
uses no assets, code, or level data from the original.*
