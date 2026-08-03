# Undermine — design

> **Status:** **M0 implemented.** The field renders with autotiling, the digger cuts it,
> and the whole thing runs on `@quarter-up/cabinet` with no local engine copy — there is
> no `src/engine/` directory at all. 31 tests. §11 is the milestone list and §13 is what
> we do not yet know.
>
> Chosen as the third cabinet for a specific reason: it is playable well on a keyboard.
> Four directions and one button, no twitch aiming, no gamepad required — which matters,
> because the controller detection in Bracer has never worked on this hardware and the
> only pad available is six thousand miles away.

---

## Table of contents

0. [Naming](#0-naming)
1. [Goals and non-goals](#1-goals-and-non-goals)
2. [Legal / originality constraint](#2-legal--originality-constraint)
3. [Reference: how the original works](#3-reference-how-the-original-works)
4. [Single-player adaptation decisions](#4-single-player-adaptation-decisions)
5. [Controls](#5-controls)
6. [Technical architecture](#6-technical-architecture)
7. [What it takes from the cabinet and from Bracer](#7-what-it-takes-from-the-cabinet-and-from-bracer)
8. [Core systems in detail](#8-core-systems-in-detail)
9. [Data formats](#9-data-formats)
10. [Content plan](#10-content-plan)
11. [Implementation milestones](#11-implementation-milestones)
12. [Testing and fidelity validation](#12-testing-and-fidelity-validation)
13. [Risks and open questions](#13-risks-and-open-questions)
14. [Sources](#14-sources)

---

## 0. Naming

**Working title: Undermine.** Package and directory `undermine`.

The house pattern is a title that carries the source game sideways. *Bracer* is arm
armour, as is a gauntlet. *Double Bubble* is a chewing gum, a cauldron, and very nearly
the cadence of the original. *Undermine* is the same trick: to undermine is literally to
dig beneath something until it collapses, which is the entire mechanic — you do not shoot
the rock, you remove what holds it up. It is also what the enemies do to you, and it
reads as a word a 1982 cabinet would have been happy to carry.

Rejected: *Sandhog* (the real term for a tunnel worker, but nobody knows it), *Deepcut*
(reads as surgery), *Spadework* (accurate, dull).

---

## 1. Goals and non-goals

**Goals**

- A faithful reconstruction of the 1982 arcade game's *mechanics*, with modernised
  presentation, in the same house style as the other two cabinets.
- Keyboard-first and genuinely comfortable there. This is the reason the game was picked
  and it outranks pad support, which is a nice-to-have rather than a requirement.
- Reuse Bracer's terrain layer rather than reinventing it. Destructible tiles, the tile
  atlas, the flow field and the spatial grid all exist and all fit — see §7.
- Finish the fidelity pass rather than leaving it open. This game is almost entirely
  *discrete* — grid movement, integer pump stages, countable score tiers — so unlike
  Double Bubble there are very few continuous constants that can only be settled from
  frame-stepped footage. See §12.

**Non-goals**

- Two-player. The original alternates rather than playing simultaneously, so there is no
  co-op design to adapt around; a second player is a second run. Out of scope entirely.
- Dig Dug II, *Digging Strike*, or any later sequel's mechanics.
- The exact sprite art. Ours is authored fresh at 32×32 with an indexed palette, as with
  the other two.

---

## 2. Legal / originality constraint

Same position as the other two cabinets, and it is not negotiable:

- No assets, code, ROM data, or level data from the original.
- Mechanics are reconstructed from public documentation and observation, and where a
  value is inferred rather than sourced it is tagged `[i]` in `data/tuning.ts` and listed
  in §13. The grading scheme introduced for Double Bubble applies here from the start —
  `[hw]` hardware fact, `[der]` derived, `[con]` constrained by a test, `[i]` free choice.
- Names are ours. The enemies are not called Pooka and Fygar; see §3 for what they do and
  §10 for what we call them.

---

## 3. Reference: how the original works

A single screen of solid earth, four horizontal bands of it in different colours, with a
strip of sky at the top. The player starts in a short pre-dug tunnel and carves the rest.

### 3.1 Digging

Movement *is* digging. Moving into earth removes it and the player occupies the space;
moving through existing tunnel is faster than cutting new earth. Tunnels are the only
place most things can travel, so the shape of the level is something the player creates
and then has to live inside — including the escape routes they did or did not cut.

This is the central inversion worth stating plainly: in Bracer the level is given to you
and you learn it. Here you *author* it under time pressure, and a bad tunnel network is a
self-inflicted trap.

### 3.2 The enemies

Two kinds:

- **Round ones.** Walk the tunnels toward the player. No ranged attack; lethal on contact.
- **Dragons.** The same, plus a horizontal jet of flame down the tunnel they face. The
  flame is the only ranged threat in the game and it only ever travels sideways, which is
  what makes approaching one from above or below the safe line and approaching it along
  its own tunnel the dangerous one.

**Ghosting is the mechanic that makes the game work.** Both kinds periodically dissolve
and pass *directly through the earth* toward the player, ignoring the tunnel network
entirely, then re-solidify when they reach open space. Without it, a player could dig a
single safe pocket and camp; with it, no place is safe and the tunnel network is a
convenience rather than a wall. A ghosting enemy is exactly as lethal as a solid one.

### 3.3 The pump

The player's weapon inflates rather than shoots. Attaching takes a button press and each
further press adds a stage; **four bursts the target** `[i]`. An interrupted inflation
deflates back to normal over a couple of seconds and the enemy resumes.

That decay is what makes the pump interesting, and it is why this is not simply a gun.
Two pumps immobilise an enemy for roughly two seconds `[i]` without killing it, so the
pump doubles as a crowd-control tool: freeze the one in the way, walk past, come back. A
player who only ever uses it to kill is playing it as a slow gun and will lose.

### 3.4 Rocks

Each level holds a small number of boulders embedded in the earth. Dig out what is
beneath one and it falls, crushing anything under it — enemies *and* the player. This is
the high-scoring kill and the only way to kill several things at once.

Rocks do not respawn. There is a fixed supply per level, which makes each one a decision
rather than a resource.

### 3.5 The bonus

After two rocks have been dropped, a bonus item appears at the centre of the screen for a
limited time. Eating it is worth substantially more than an enemy. Its value climbs with
level number.

The rule is worth noticing: the bonus is gated on *dropping rocks*, not on time or on
kills. The game is explicitly paying you to play the risky, elaborate way.

### 3.6 The last enemy

When one enemy remains it stops hunting and flees for the top-left of the screen, where
it escapes and ends the level. So the level does not end when the last enemy is killed —
it ends when the last enemy *leaves*, unless you catch it first. Chasing it down is
optional points and a real risk.

### 3.7 Structure and difficulty

Roughly fifteen distinct earth layouts, after which late layouts repeat in a cycle `[i]`.
Enemies get faster with level number; the count and mix change. Points for bursting an
enemy scale with the **depth** it dies at, so the deep bands are worth more — which pulls
the player downward, away from the exit and away from safety, for money.

### 3.8 Scoring, as far as it is documented

| Event | Value |
| --- | --- |
| Burst a round one | 200 / 300 / 400 / 500 by depth band `[i]` |
| Burst a dragon | Double a round one's, when killed along its firing line `[i]` |
| Rock crush | 1,000 for one, rising steeply for each extra caught in the same fall `[i]` |
| Bonus item | 400 upward, by level `[i]` |

Every row is `[i]`. Public sources agree on the shape — depth scales, dragons are worth
more the riskier way, multi-crushes escalate — and disagree or go vague on the exact
numbers. §12 says what we do about that.

---

## 4. Single-player adaptation decisions

Very little to do here, which is part of the appeal after two games that each needed a
chapter of it.

| # | Original | Ours | Why |
| --- | --- | --- | --- |
| 4.1 | Two players alternating | One player, one run | Alternating is not a co-op design; it is two runs sharing a cabinet. Nothing to adapt. |
| 4.2 | Endless level cycle, no ending | Same | It is a score game. The other two cabinets both keep this. |
| 4.3 | Lives and extends | Kept, with the difficulty ladder Bracer built | Bracer's five-rung ladder is already in the shared vocabulary and players expect it now. |
| 4.4 | Fixed layout set | Kept, plus a generator for practice | The editor and validator exist. See §10. |

---

## 5. Controls

Four directions and one button. That is the whole game, and it is why it was chosen.

| Action | Keyboard | Alt | Pad |
| --- | --- | --- | --- |
| Move / dig | Arrows | `WASD` | D-pad or stick |
| Pump | `Space` | `J` | `A` / cross |
| Pause | `P` | `Esc` | Start |

No diagonals. Movement is four-way on purpose — the original's is, the tunnels are
orthogonal, and a diagonal input on a grid this coarse would either be ignored or would
carve a staircase nobody asked for.

Bracer's lesson applies: any bound key with a browser default of its own must be in the
cabinet's swallow list, and no action may sit on a bare modifier.

---

## 6. Technical architecture

Identical in shape to the other two, because that is the point of the monorepo.

```
games/undermine/
  src/
    engine/       what the cabinet does not cover — see §7
    data/         tuning.ts, layouts, scoring tables
    game/         simulation: field, digger, enemies, rocks, pump
    render/       sprite and tile generation, the pixel canvas
    ui/           cabinet shell, screens
  tools/          layout generator, editor
  tests/
```

Rules carried over from both existing games, unchanged:

- Fixed 60Hz timestep. `step()` never renders, `draw()` never mutates.
- World units only below `ui/`. Nothing in `game/` may reference a screen pixel.
- No `Math.random` or `Date` in the simulation — seeded RNG only, so a run replays.
- `data/tuning.ts` is the only place a gameplay constant may live.

---

## 7. What it takes from the cabinet and from Bracer

This is the first game to be built *on* `@quarter-up/cabinet` rather than by copying an
engine and diffing later. The loop, display scaling, keyboard, gamepad, RNG, storage and
audio synthesis all come in as a dependency on day one.

From Bracer's game layer, by copying — the same rule as before, since a third game is the
first real test of whether these generalise:

| Taken | Why it fits |
| --- | --- |
| `terrain.ts` — tile grid, destructible cells | Earth *is* destructible terrain. Bracer's breakable walls already model "a cell that stops being solid", including the damage bookkeeping and the renderer's dirty tracking. |
| `ai.ts` — `FlowField` | Enemies path through tunnels toward the player. This is exactly what the field was built for, and unlike Bracer's thief they will all use it. |
| `spatial.ts` | Fewer entities than Bracer, but the same job. |
| The tile atlas and blob autotiling | Earth banded in four colours with carved tunnels is a 47-piece autotile problem and nothing else. This is the single biggest saving. |
| `levelkit`'s reachability analyser | A layout where a rock seals the only route, or an enemy starts somewhere it can never leave, must fail the build rather than ship. |

What does **not** come across, and should not:

- Bracer's `chase()` greedy pursuit. These enemies path properly; the greedy version is
  authentic to Gauntlet and wrong here.
- Anything from Double Bubble. No gravity, no platforms — rocks fall, but a rock is one
  entity on rails, not a physics body. Emphatically not worth importing a platformer core
  for.

**What this should teach the cabinet.** If `terrain.ts` survives being used by a game
where the terrain is the mechanic rather than the scenery, that is strong evidence it
belongs in `packages/` at the next extraction. If it does not, that is worth knowing too.

---

## 8. Core systems in detail

### 8.1 The field

A grid of cells, each *earth* or *tunnel*, in four coloured bands plus sky. Tunnels are
carved a whole cell at a time by movement.

The decision to make deliberately and early: **cell-aligned digging, not a pixel mask.**
The original's tunnels look continuous, and a mask would reproduce that more exactly — but
a mask makes enemy pathing, rock support and the autotiler all substantially harder, and
the game reads correctly on a grid provided the grid is fine enough. Start on the grid.
If it looks wrong, that is a §12 finding and not a surprise.

### 8.2 Movement

Four-way, grid-aligned, with the player snapping to the axis they are travelling on.
Cutting fresh earth is slower than running an existing tunnel `[i]` — that speed
difference is most of what makes tunnel layout matter, so it is a headline constant, not
a detail.

### 8.3 Enemies

Two behaviours over one body:

- **Tunnel pursuit.** Flow field to the player, rebuilt when the player changes cell.
  Cheap — Bracer already does this for the thief over a larger grid.
- **Ghosting.** On a timer, and more often the longer an enemy has been unable to make
  progress `[i]`. Leaves the tunnel network, travels the straight line to the player
  through earth without disturbing it, re-solidifies on reaching open space.

The second is the interesting one to get right, and the failure modes are known in
advance: ghost too often and tunnels are pointless, too rarely and camping wins. The
trigger being *progress-based* rather than purely random is the reconstruction worth
testing — it is what makes walling yourself in specifically fail.

Dragons additionally emit a horizontal flame down their own tunnel on a cooldown, with a
wind-up long enough to be escaped by a player who is watching.

### 8.4 The pump

A short-range attachment, not a projectile: it reaches one or two cells along the facing
axis and holds while the button is pressed. Stages inflate; the top stage bursts. Release
and the target deflates over a couple of seconds `[i]`.

Scoring reads the target's **depth band** at the moment it bursts, which is what makes
dragging something deeper before finishing it a real tactic.

### 8.5 Rocks

One entity type with one rule: supported by the cell beneath it until that cell becomes
tunnel, then it falls, then it lands and shatters. Anything caught — enemy or player —
dies. A fall that catches several enemies scores escalating.

Deliberately simple, deliberately not a physics body, and the one place the game has
anything resembling gravity.

### 8.6 Round flow

Start with a pre-cut tunnel and a fixed enemy set. Clear it, or let the last one escape.
The bonus appears after the second rock has fallen. Score, next layout, enemies faster.

---

## 9. Data formats

A layout is JSON, validated at load exactly as Bracer's levels are:

```jsonc
{
  "id": "L03",
  "name": "Crosscut",
  "bands": ["topsoil", "clay", "shale", "bedrock"],
  "earth": ["....", "XXXX"],       // rows; X earth, . pre-cut tunnel
  "start": [7, 4],
  "rocks": [[3, 8], [12, 11]],
  "enemies": [ { "kind": "round", "x": 4, "y": 9 } ]
}
```

Hand-editable, generated by a recipe, and checked by the analyser before it can ship.

---

## 10. Content plan

Roughly fifteen layouts to match the original's structure, built the way Bracer's forty
were: short recipes over a named vocabulary of patterns, not forty hand-drawn grids and
not noise.

Enemy names are ours. Working set: **Grubs** (the round ones) and **Emberjaws** (the
dragons), with the bonus items as ordinary root vegetables, which the original already
did and which needs no invention.

---

## 11. Implementation milestones

| | Scope | Accept |
| --- | --- | --- |
| **M0** | Skeleton. Workspace on `@quarter-up/cabinet`, canvas, a field of earth rendering with autotiling, a digger that carves it. | **Done.** Builds, 31 tests, lane-locked digging at two speeds. |
| **M1** | Movement and terrain. Four-way grid movement, the dig-speed difference, rocks falling and killing. | A rock can be dropped on the player. Speed difference is measurable in a test. |
| **M2** | Enemies. Tunnel pursuit on the flow field, ghosting, contact death, the dragon's flame. | Neither camping nor open ground is safe. |
| **M3** | The pump. Stages, decay, bursting, depth-band scoring, the immobilise tactic. | Pump-and-stall is viable without being dominant. |
| **M4** | Presentation. Sprites, the four bands, audio voices, the cabinet shell, score and lives. | Looks and sounds like a cabinet. |
| **M5** | Content. Fifteen layouts, the level cycle, difficulty ramp, bonus items, the last-enemy escape. | A full run start to finish. |
| **M6** | Polish, and whatever the third game teaches the shared package — §7 predicts `terrain.ts`. | Both other games still green after any extraction. |

---

## 12. Testing and fidelity validation

The lesson from Double Bubble, applied from the start rather than at M6.

- **Constants are graded on the day they are written**, `[hw]`/`[der]`/`[con]`/`[i]`.
- **An observables test from M1.** Every constant is stated in units a person can count —
  cells per second, frames to cut a cell, pumps to burst, seconds to deflate. `GRAVITY:
  0.1684` is not a claim anyone can check; "the digger crosses the screen in 4.2s" is.
- **Layout validation in CI**, reusing the analyser: every enemy can reach the player's
  start, no rock seals the only route, the level is completable.
- **This game can actually finish its fidelity pass.** Almost everything is discrete —
  pump stages, depth bands, score tiers, cell counts. Those are countable from any
  recording, including of a legitimate re-release. The continuous values are few: dig
  speed, ghost rate, deflate rate. That is a short list, and §13 tracks it.

---

## 13. Risks and open questions

| Risk | Note |
| --- | --- |
| **The scoring tables are `[i]` across the board.** | Sources agree on shape and disagree on numbers. Settle by counting a recording; until then the shape is what is implemented and the numbers are flagged. |
| **Ghost frequency is the balance of the whole game.** | Too high and tunnels are pointless, too low and camping wins. The progress-based trigger in §8.3 is a reconstruction, not a documented rule. |
| **Cell-aligned digging may read as too chunky.** | §8.1 commits to the grid first and names the alternative. Decide on evidence at M4, not now. |
| **No arcade disassembly is known to exist.** | Same position as Double Bubble. Checked during research; if one surfaces, it outranks everything in §14. |
| **`terrain.ts` may not survive contact.** | It was written for walls that occasionally break, not earth that is mostly removed. If it needs forking rather than adapting, that is a finding about the extraction, not a failure. |

---

## 14. Sources

- [StrategyWiki — Dig Dug](https://strategywiki.org/wiki/Dig_Dug) — gameplay and walkthrough structure
- [Arcade History — Dig Dug](https://www.arcade-history.com/game/637/dig-dug) — cabinet and release facts
- [MobyGames — Dig Dug](https://www.mobygames.com/game/139/dig-dug/) — general reference
- [Museum of the Game — Dig Dug](https://www.arcade-museum.com/Videogame/dig-dug) — cabinet and release facts
- [SUPERJUMP — Inside the Arcade: Dig Dug](https://www.superjumpmagazine.com/inside-the-arcade-dig-dug-1982/) — design commentary
- [Pookapedia — Dig Dug](https://digdug.fandom.com/wiki/Dig_Dug) — enemy behaviour, ghosting
- Reference recording, frame-stepped — **to be captured at M1**, and the source of the
  short list of continuous constants in §12

> **Excluded:** `arcadeadvantage.com/dig-dug-controls-enemies-and-scoring/` looked like the
> best scoring source in search results, but the URL 302s to a `ww80.` subdomain with a
> tracking `subid1` parameter — a parked-domain ad redirect rather than the article. Not
> followed, not used. If the real article exists, fetch it manually in a browser and check
> what is actually being served before citing it.
