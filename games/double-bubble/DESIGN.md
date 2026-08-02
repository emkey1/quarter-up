# Double Bubble — Design & Implementation Document

*An homage to Taito's **Bubble Bobble** (arcade, 1986).*

> **Status:** M0 in progress — engine substrate copied and decoupled, room format and
> renderer landed. Physics is M1. See §11 for the milestone table.

---

## Table of contents

- [0. Naming](#0-naming)
- [1. Goals and non-goals](#1-goals-and-non-goals)
- [2. Legal / originality constraint](#2-legal--originality-constraint)
- [3. Reference: how the original works](#3-reference-how-the-original-works)
- [4. Single-player adaptation decisions](#4-single-player-adaptation-decisions)
- [5. Controls](#5-controls)
- [6. Technical architecture](#6-technical-architecture)
- [7. What ports from Bracer](#7-what-ports-from-bracer)
- [8. Core systems in detail](#8-core-systems-in-detail)
- [9. Data formats](#9-data-formats)
- [10. Content plan](#10-content-plan)
- [11. Implementation milestones](#11-implementation-milestones)
- [12. Testing and fidelity validation](#12-testing-and-fidelity-validation)
- [13. Risks and open questions](#13-risks-and-open-questions)
- [14. Sources](#14-sources)

---

## 0. Naming

**Working title: Double Bubble.** Package and directory `double-bubble`.

Bracer takes its name obliquely — a bracer is arm armour, as is a gauntlet. This one
takes the opposite route and leans in: *"Double, double toil and trouble"* is Macbeth's
witches over a bubbling cauldron, and it is very nearly the cadence of *Bubble Bobble*
already. The title carries the source, the mechanic, and a witches'-brew reading of the
cave all at once, and it sounds like something that would have been painted on a cabinet
side-art in 1986.

It also quietly names the two-player original that §4 has to adapt around — which is a
good joke to have sitting on the title screen of a single-player game.

---

## 1. Goals and non-goals

**Goals**

- Reproduce the *feel* of the 1986 arcade original: its jump arc, its bubble drift, the
  moment a bubble turns red under you.
- Reproduce its hidden depth. Bubble Bobble's defining quality is not the bubbles — it
  is the enormous, invisible, deterministic reward system underneath them (§3.9). A
  version without that is a platformer with a novel weapon. A version with it is
  *Bubble Bobble*.
- 100 single-screen rooms, the secret rooms, the warps, a final boss.
- Keyboard and gamepad, same standard as Bracer.
- Single player, honestly adapted rather than crippled (§4).

**Non-goals**

- Two-player co-op. Bracer set the single-player precedent and the whole cabinet shell
  assumes it. Revisit only if the shared package makes it cheap.
- Pixel-exact sprite recreation. Bracer generates its art procedurally; so does this.
- Emulating arcade timing at the cycle level. We match observable behaviour, not the
  6809's instruction budget.

---

## 2. Legal / originality constraint

Same standard as Bracer, and it is not negotiable:

- No assets, code, level data, or ROM-derived tables from the original.
- Room layouts are **original designs** that teach the same ideas in the same order.
  They are not transcriptions of Taito's 100 rooms.
- Character designs are our own. No Bub, no Bob, no green dragon. The player is a
  creature that blows bubbles; that is a mechanic, not a character.
- Mechanics, physics relationships, and numeric thresholds are facts about how a system
  behaves, gathered from public documentation — those we reproduce deliberately.
- README carries the same unaffiliated-homage notice.

---

## 3. Reference: how the original works

### 3.1 Screen and room structure

- Fixed single screen per room, no scrolling. Arcade playfield 256×224 at 8px tiles →
  **32×28 tiles**.
- 100 rooms, played in sequence. Room advances when the last monster dies.
- **Vertical wrap:** falling off the bottom of the screen returns you at the top. This
  is load-bearing — it is a traversal tool, not a hazard, and the "fall N times" counter
  (§3.9) exists because of it.
- Left and right edges are solid in the general case. *Verify against reference footage
  whether any rooms wrap horizontally.*
- Platforms are **one-way**: jumped through from below, landed on from above.

### 3.2 Player movement

Exact constants are not publicly documented — no usable disassembly surfaced. Derive
them frame-by-frame from reference footage during M1 (§12), and record what we land on
in `src/data/tuning.ts` the way Bracer does.

Qualitative shape to hit:

- Run speed is modest; the **red shoe** item raises it noticeably.
- Jump is fixed-height, not variable — no hold-to-jump-higher. Arc is floaty with a long
  hang time, which is what makes bubble-riding viable.
- No air control penalty worth modelling; horizontal steering in the air is free.
- Landing has no recovery frames.

### 3.3 The bubble lifecycle

The single most important system. A bubble passes through:

1. **Fired.** Travels horizontally in the facing direction for a short distance,
   decelerating.
2. **Floating.** Rises slowly, then joins the room's **drift current** (§3.3.1).
3. **Trapped** (if it hit a monster). The monster is held, and its escape clock starts.
4. **Angry.** The bubble reddens as the clock runs down — a visible warning, not a
   surprise.
5. **Escaped** or **popped.**

Bubbles can be **stood on and ridden**, which is the primary route to otherwise
unreachable platforms. They can also be **pushed** by walking into them gently, without
the player's spines contacting them — this is how a skilled player herds several bubbled
monsters together before popping the cluster.

Popping is by contact with the player's back/spines, or by pushing a bubble into
geometry. **Adjacent bubbles chain-pop**, and the chain is the entire scoring engine
(§3.8).

#### 3.3.1 Drift currents

> Bubbles drift around the level on their own after they've been blown, with every level
> having a different path that they flow along.
> — [StrategyWiki](https://strategywiki.org/wiki/Bubble_Bobble)

Each room defines a per-room current that carries free bubbles along a path. This is
authored level data, not physics, and it is a major part of each room's character. It
needs to be first-class in the level format (§9) and paintable in the editor.

#### 3.3.2 The escape clock varies per room

> The rate at which enemies can burst free from bubbles changes from stage to stage. It
> can change more drastically than other speeds.

So escape time is a **per-room tuning value**, not a global constant. Some rooms are
deliberately frantic. Model it as a room field with a global default.

### 3.4 Special bubbles

Drift in on some rooms; pop them to release the contents.

| Bubble | Effect | Kill converts monsters to |
| --- | --- | --- |
| **Water** | Releases a stream that flows down and along platforms, sweeping monsters with it | 7,000-pt diamonds |
| **Lightning** | Fires a bolt horizontally; direction set by which side the player pops it from | 8,000-pt diamonds |
| **Fire** | Drops flame onto the platform below, which burns for a while | 9,000-pt diamonds |

The water stream is the interesting one to implement — it is a flowing volume that
follows level geometry and accumulates monsters as it goes, not a projectile.

### 3.5 Monster roster

Eight regular types, introduced on a strict schedule. Each has **normal**, **angry**,
and **bubbled** states.

| Monster | First room | Behaviour |
| --- | --- | --- |
| **Zen-Chan** | 1 | Clockwork walker. Patrols, jumps to a higher platform when the player is above. Medium speed, good jumper. The baseline. |
| **Mighta** | 6 | Walks less, shoots slow-moving boulders. |
| **Monsta** | 10 | Flies. Moves on fixed diagonals, bouncing off geometry — ignores platforms entirely, so it can reach anywhere and is awkward to bubble. |
| **Pulpul** | 20 | Floats in long sweeping horizontal arcs with little vertical movement. |
| **Banebou** | 30 | Hops rather than walks. Clears gaps and jumps up through floors, which makes its position hard to predict. |
| **Hidegons** | 40 | Throws the first *fast* projectile (fireballs). Can jump up through floors but not across gaps. |
| **Drunk** | 50 | Staff-carrying wizard; lobs bottles. |
| **Invader** | 60 | Late-game type; behaviour to confirm against footage. |

Every 16 rooms, an enlarged variant appears. Bosses: **Grumple Grommit** at room 100
(known elsewhere as Super Drunk).

### 3.6 Anger

Two separate anger systems, easy to conflate:

- **Bubble escape anger.** A bubbled monster reddens and breaks out. It emerges *angry*:
  faster, more aggressive. This is per-monster and temporary.
- **Room-wide anger.** As a room drags on, remaining monsters escalate. Feeds into the
  hurry-up.

### 3.7 The hurry-up and Baron von Blubba

- Room timer expires → **HURRY UP!** flashes.
- ~10 seconds later, **Baron von Blubba** (Skel-Monsta) enters: a white skeletal Monsta.
- **Invincible.** Cannot be bubbled, cannot be killed.
- Moves only on the horizontal and vertical axes, at timed intervals, and **passes
  through all geometry** — walls, floors, ceilings.
- Homes on the player and **accelerates continuously** until it kills someone or the
  room is cleared.
- Leaves only on room completion or player death.

It is a metronome with a grudge. The design intent is anti-camping, and it must feel
inexorable rather than merely dangerous.

### 3.8 Scoring

**Simultaneous pops are exponential:**

```
points = 2^(n-1) × 1000        for n monsters popped in one chain
```

1 → 1,000 · 2 → 2,000 · 3 → 4,000 · 4 → 8,000 · 5 → 16,000 · 6 → 32,000 · 7 → 64,000

The fruit each dead monster drops scales with `n` on the same curve (roughly 500 →
6,000). This is why the whole game is really about *herding* — a player who pops
monsters one at a time is playing a different, much poorer game than the one designed.

**EXTEND letters** drop from chain pops on a separate curve. Collecting E-X-T-E-N-D
grants an extra life *and immediately ends the room*:

| Monsters popped at once | 2 | 3 | 4 | 5 | 6 | 7 | 8+ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Letters dropped | 0 | 1 | 2 | 3 | 4 | 5 | all 6 |

**Fruit conversion:** if the hundreds and tens digits of the score match when the last
monster dies, every remaining bubble on screen turns to fruit. A deliberate,
discoverable oddity — keep it.

### 3.9 The hidden counter system

**This is the heart of the game and the reason to build it.**

The original does not randomise its rewards. It maintains a large array of counters
tracking everything the player does, and at each room start it walks a threshold list in
a fixed order. The first counter over its threshold is **reset to zero** and its
corresponding item is placed in the room.

> Internally, Bubble Bobble maintains a large array of counters, and is constantly
> watching, recording everything you do.
> — [Game Developer](https://www.gamedeveloper.com/design/exploring-the-secret-depths-of-i-bubble-bobble-i-s-design)

The result is a game that reads as mysterious but is entirely deterministic, learnable,
and — critically — **teaches itself to players who experiment**. Reproducing it faithfully
is the single highest-value thing in this project.

A representative slice (full tables in [tjasink](https://tjasink.com/games/bb/items2.html);
tuples are per-difficulty-tier thresholds):

| Item | Trigger | Effect |
| --- | --- | --- |
| Yellow sweet | Jump 35+ times | Rapid-fire bubbles |
| Blue sweet | Pop 35+ empty bubbles | Faster bubbles |
| Purple sweet | Blow 35+ bubbles | Longer bubble range |
| Red shoe | Cross the screen ~15 times | Faster running |
| Orange/red/purple umbrella | Pop 15/20/25 water bubbles | Warp 3/5/7 rooms forward |
| Purple/red/blue ring | Eat 3 of a given sweet | Points per jump / pop / step |
| Clock | Pop 12 lightning bubbles | Freezes monsters |
| Bomb | Pop (10,13,16,19) fire bubbles | Clears the room |
| Book | Kill (10,12,14,16) monsters with fire | Explosion, 8k diamonds |
| Heart | Eat (50,55,60,65) monster-drop fruits | Freeze + invincibility |
| Potions | Fall off the bottom 15–19 times | Clears room, showers collectibles for 30s |
| Silver bell | HURRY UP seen (8,10,12,14) times | Chimes before special items appear |
| Red bubble | Random, ~1 in 4096 | 100,000 pts, fire breath for 5 rooms |

Two properties that must survive into our version:

1. **Counters persist across games.** On the arcade this meant the cabinet remembered.
   Our equivalent: persist to `localStorage` via the existing storage layer, so the
   machine accumulates knowledge of *this player* across sessions. This is a lovely fit
   for a browser game and costs nothing.
2. **Thresholds scale with a hidden difficulty tier.** The `(a,b,c,d)` tuples are four
   tiers. We need the tier-selection rule — currently unknown (§13).

Sources disagree on some thresholds — the sweets are cited as 35 in two places and 51 in
another. Treat published numbers as a starting point and tune; record our chosen values
as ours.

### 3.10 Secret rooms and warps

| Trigger | Reward |
| --- | --- |
| Reach room 20, 30, or 40 without losing a life | Silver door → secret room: gems, plus a cryptogram hinting at the true ending |
| Reach room 50 without losing a life | Gold door → warp to room 70 |
| Umbrellas | Warp 3, 5, or 7 rooms forward |

The secret rooms contain the game's lore delivered as **encoded messages** — the room 20
cryptogram concerns defeating the boss to return the heroes to human form; room 30 hints
that a "Drug of Thunder" is the means. A monster called **Rascal** hunts the player in
secret rooms, without warning.

Deathless-run gating plus cryptograms is a strong design and worth keeping wholesale.

### 3.11 Endings

In the original the true ending is **unreachable in single player** — it needs a second
player to join during the boss fight, and the 100 rooms completed twice (the second pass
being "Super Mode", faster and with the monster roster swapped for counterparts). §4
covers what we do instead.

---

## 4. Single-player adaptation decisions

Bracer already solved "a co-op arcade game, alone." Same philosophy: adapt the intent,
don't just delete the second player.

| Original | Problem alone | Our decision |
| --- | --- | --- |
| True ending requires 2P | Unreachable | Gate the true ending on **mastery instead of a second body**: complete Super Mode having found all three secret rooms. Same "you must truly know this game" intent, reachable solo. |
| 2 Baron von Blubbas in 2P | n/a | One Baron. Keep the acceleration curve; it is the pressure. |
| Chain pops need herding two players can set up | Big chains get much harder alone | Do **not** soften the exponential curve. Instead lean on bubble *pushing* (§3.3) so a solo player can still assemble a cluster, and tune bubble escape times per room with solo play in mind. |
| Lamp triggers keyed to "P2 joins 5 times" | Impossible | Rekey to a solo-achievable behaviour of similar rarity. Candidates in §13. |
| Super Mode as a second full pass | 100 more rooms is a lot alone | Keep it, but it is the *optional mastery track*, not a requirement to see an ending. A good ending on pass 1; the true ending on the mastery track. |
| Continue-heavy arcade economy | Trivialises everything | Bracer's approach — finite lives, scores that mean something. Match it. |

---

## 5. Controls

Match Bracer's input layer exactly; it is already good and already ported (§7).

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move | ← → / A D | Left stick, D-pad |
| Jump | Space / W / ↑ | A (south) |
| Blow bubble | J / Z / Ctrl | X (west) |
| Pause | Esc / P | Start |
| Setup | Tab | — |

Notes:

- Jump is fixed-height; no hold-to-jump-higher. Resist adding it — it changes bubble
  riding fundamentally.
- Bubble fire should be comfortably mashable; the rapid-fire sweet makes it more so.
- Retain Bracer's gamepad remapping screen and its pad-test page verbatim.

---

## 6. Technical architecture

Same stack as Bracer, unchanged: TypeScript, Vite, canvas, no runtime dependencies,
Vitest for the simulation layer.

```
games/double-bubble/
  index.html
  editor.html              room editor, same rationale as Bracer's
  src/
    engine/                copied from Bracer at M0 — see §7
    render/                pixel/sprite/tile generation copied; the rest new
    game/                  all new
      physics.ts           gravity, one-way platforms, vertical wrap
      bubble.ts            lifecycle, drift, riding, chain-pop resolution
      monster.ts           roster, states, anger
      baron.ts             the hurry-up chaser
      water.ts             flowing water volumes
      counters.ts          §3.9 — the counter array and threshold walk
      items.ts             item table and effects
      room.ts              load, spawn, clear conditions
      score.ts             exponential chains, EXTEND, fruit conversion
    ui/                    cabinet shell, mostly copied
    data/
      rooms/               100 room JSON files
      tuning.ts            all constants, one place
      items.ts             the threshold table
```

The counter system deserves its own module and its own test file. It is the thing most
likely to be subtly wrong and least likely to be noticed being wrong.

---

## 7. What ports from Bracer

**Copy, do not share.** `packages/` stays empty until this game is playable — the
reasoning is in [packages/README.md](../../packages/README.md). Copy these into
`games/double-bubble/src/` at M0 and let them diverge; we extract at M6 from two real examples.

| Source | LOC | Action |
| --- | --- | --- |
| `engine/loop.ts` `input.ts` `keyboard.ts` `gamepad.ts` `rng.ts` `storage.ts` `audio.ts` `speech.ts` `display.ts` `pointer.ts` `padlog.ts` `actions.ts` | ~2,000 | **Copy near-verbatim.** Cut the `@/data/tuning` import in the six files that have it — pass config in instead. Doing this at copy time makes the M6 extraction almost free. |
| `engine/spatial.ts` | 130 | Copy, but expect divergence — it is built for a scrolling top-down grid. |
| `render/pixel.ts` `spritegen.ts` `tilegen.ts` `particles.ts` `theme.ts` `ui.ts` `fx.ts` | ~1,500 | **Copy.** Procedural sprite/tile generation is the most valuable shared asset and is genuinely game-agnostic. |
| `render/autotile.ts` `lighting.ts` `tilemap.ts` `tileatlas.ts` `sprites.ts` `hud.ts` | ~1,000 | **Reference only.** Dungeon-specific. Read them, rewrite for a single fixed screen. |
| `ui/app.ts` `screen.ts` `setup.ts` `attract.ts` `highscores.ts` `gameover.ts` `announcer.ts` `padtest.ts` | ~2,000 | **Copy the shell.** The cabinet furniture — attract mode, setup, high scores, gameover — is exactly the reusable part. Restyle, keep the structure. |
| `ui/charselect.ts` `play.ts` `levelintro.ts` `presentation.ts` | ~1,000 | **Rewrite.** No class select here; the play loop is entirely different. |
| `game/*` | 3,225 | **Nothing.** A top-down crawler and a gravity platformer share no game code. Do not attempt to generalise `collision.ts`. |
| `tools/levelkit.mjs` `editor/` | ~1,500 | **Reference.** The editor's shape — live playability validation, playtest-in-the-real-game — is the right shape here too. The content is different. |

Rough expectation: ~3,500 lines copied, ~1,000 rewritten from a good reference,
everything else new.

---

## 8. Core systems in detail

### 8.1 Physics

Fixed-timestep, same as Bracer's loop. Per frame: apply gravity, integrate, resolve.

One-way platforms: collide top-down only. A body moving upward passes through; a body
moving downward collides if it crossed the platform's top edge this frame. Standard, but
the *ordering* against the vertical wrap matters — wrap after resolution, not before, or
a player landing on the top row will tunnel.

Vertical wrap: when `y > screenHeight`, set `y -= screenHeight`. Applies to the player,
to monsters, and to items. Bubbles rise, so they wrap the other way if at all — *verify*.

### 8.2 Bubbles

State machine per §3.3. Notes that will bite otherwise:

- **Chain-pop resolution** must be a flood fill over an adjacency graph built fresh each
  pop, and the whole chain resolves in one frame so the score multiplier is computed
  once against the total. Popping serially gives wrong scores.
- **Riding** means a bubble is a moving one-way platform. It is the same collision path
  as §8.1 — make bubbles participate in it rather than special-casing.
- **Pushing** requires distinguishing player-back contact (pop) from player-front contact
  (push). This is a facing check plus a contact-point check, and it is fiddly. Budget
  real time for it; it is the skill ceiling of the whole game.
- **Drift** reads a per-room vector field (§9). Free bubbles sample it; trapped bubbles
  sample it too.

### 8.3 The counter system

```ts
// Every tracked behaviour increments a counter. At room start, walk the
// threshold table in fixed order; the FIRST counter over its threshold is
// reset to zero and its item spawns. One item per room, deterministic.
```

Design constraints:

- The walk order is **fixed and significant** — it establishes item priority. Author it
  explicitly as an ordered array, not an object.
- Counters persist to `localStorage` and survive across sessions.
- Provide a debug overlay showing live counter values against thresholds. Without it
  this system is untestable by hand.
- Unit-test the walk: given a counter state, exactly one item, the right one, reset
  correctly.

### 8.4 Baron von Blubba

Axis-locked movement on a timed interval, ignoring all geometry, homing on the player,
with a speed that increases monotonically from spawn. Three parameters: initial interval,
acceleration rate, and step size. Tune so that a competent player has roughly 20–30
seconds before it becomes genuinely unsurvivable.

### 8.5 Water

A flowing volume, not a projectile. Model as a set of occupied cells that spreads
downward and along platform surfaces each tick, carrying any monster it touches. It
should pool, fall off ledges, and eventually drain off the bottom of the screen.
The most novel piece of code in the project.

---

## 9. Data formats

Room JSON, mirroring Bracer's approach:

```jsonc
{
  "id": "r001",
  "tiles": "…",            // 32×28, run-length or per-row strings
  "spawns": [              // monster type + tile position + initial facing
    { "type": "zenchan", "x": 4, "y": 20, "dir": 1 }
  ],
  "drift": {               // §3.3.1 — the room's bubble current
    "field": "…",          // per-cell direction, paintable in the editor
    "speed": 0.4
  },
  "escapeTime": 480,       // §3.3.2 — frames before a bubbled monster breaks out
  "specialBubbles": ["water"],
  "timer": 1800            // frames until HURRY UP
}
```

The drift field is the piece with no Bracer precedent. It wants a paint tool in the
editor with an animated preview showing test bubbles flowing — authoring it blind would
be miserable.

---

## 10. Content plan

100 rooms, following the original's teaching schedule (§3.5) since it is well-judged:

| Rooms | Introduces |
| --- | --- |
| 1–5 | Zen-Chan. Bubbles, riding, chain pops. Geometry stays simple. |
| 6–9 | Mighta and projectiles. |
| 10–19 | Monsta — first monster that ignores platforms. |
| 20–29 | Pulpul. **Secret room at 20.** |
| 30–39 | Banebou. **Secret room at 30.** |
| 40–49 | Hidegons, fast projectiles. **Secret room at 40.** |
| 50–59 | Drunk. **Gold door at 50 → warp to 70.** |
| 60–69 | Invader. Full roster in combination. |
| 70–99 | Combination and escalation. Tightest geometry, meanest drift fields. |
| 100 | Boss. |

Every 16th room gets an enlarged variant. Rooms are original layouts (§2) that teach the
same idea at the same point.

Generate a first pass procedurally the way Bracer's `levelgen.mjs` does, then hand-tune.
A single-screen platformer has a much smaller design space than a scrolling dungeon, so
expect the hand-tuning fraction to be higher.

---

## 11. Implementation milestones

| M | Scope | Done when |
| --- | --- | --- |
| **M0** | Skeleton. Copy engine + render substrate (§7), strip the `tuning` coupling, get a canvas rendering a static room with the cabinet shell around it. | Dev server runs, room draws, tests pass. |
| **M1** | Physics core. Movement, fixed jump, one-way platforms, vertical wrap. No monsters. | Jump arc matches reference footage frame-for-frame. |
| **M2** | Bubbles. Full lifecycle, drift, riding, pushing, chain-pop resolution. Zen-Chan only. | A room is clearable; a 3-chain scores 4,000. |
| **M3** | Monster roster. All eight types, anger states, the hurry-up and Baron von Blubba. | Every monster behaves per §3.5 and the Baron is genuinely frightening. |
| **M4** | Items and the counter system (§3.9). Special bubbles, water flow, EXTEND, fruit conversion. Debug counter overlay. | Counters persist across reloads; each item is reachable by its documented behaviour. |
| **M5** | Content. 100 rooms, room editor with drift painting, secret rooms and cryptograms, warps, boss, Super Mode. | Playable start to finish; true ending reachable per §4. |
| **M6** | Polish — **and the `packages/cabinet` extraction.** Diff this game's copied engine against Bracer's, extract what stayed identical. | Both games run on the shared package; neither regressed. |

M6 is where the monorepo decision pays off. Don't skip it, and don't do it earlier.

---

## 12. Testing and fidelity validation

Bracer's test suite (328 tests over 18 files) covers the simulation layer with the
renderer excluded. Same approach.

Specific to this game:

- **Frame-accurate jump validation.** Capture reference footage, step it frame by frame,
  record apex height and airtime in tiles and frames, assert against our physics in a
  unit test. This is the one measurement everything else hangs off.
- **Chain-pop scoring.** Table-driven: n monsters → `2^(n-1) × 1000`, and the EXTEND
  letter curve.
- **Counter walk.** Given a counter vector, assert exactly one item, the correct one,
  and the correct reset.
- **Drift determinism.** A bubble released at a fixed position with a fixed field must
  follow an identical path every run — no RNG in drift.
- **Room clearability.** Extend Bracer's editor-side validation: every room must be
  provably completable. For a platformer that means a reachability flood fill over jump
  arcs *including* bubble-riding, which is harder than Bracer's walk-reachability check
  and worth building properly.

---

## 13. Risks and open questions

| Risk | Notes |
| --- | --- |
| **Physics constants are unpublished.** | No usable disassembly surfaced. Everything comes from frame-stepping reference footage. Biggest single source of "feels wrong." Front-load it in M1 — every later system inherits the error. |
| **Bubble pushing is subtle.** | Front-contact-pushes / back-contact-pops is the game's skill ceiling and easy to get mushy. Prototype it early inside M2 rather than at the end. |
| **The difficulty-tier rule is unknown.** | Item thresholds are documented as 4-tuples but the tier-selection rule isn't. Likely tied to rooms cleared or a cabinet DIP setting. Decide our own rule and document it as ours. |
| **Source thresholds disagree.** | Sweets cited as 35 and as 51. Published numbers are a starting point, not gospel. |
| **P2-keyed triggers need rekeying.** | Two lamps key off "player N joins a running game 5 times." Candidate replacements: deaths-without-continue, secret rooms found, deathless room streak. Pick something with comparable rarity. |
| **Water flow is unbudgeted.** | No analogue in Bracer. Genuinely novel code. Assume it takes longer than it looks. |
| **Horizontal wrap unconfirmed.** | Vertical wrap is certain. Confirm the horizontal case before building rooms that depend on either answer. |
| **Invader behaviour unconfirmed.** | Late-game type, thinly documented. Verify against footage in M3. |
| **Scope.** | 100 rooms plus a counter system plus Super Mode is larger than Bracer. The counter system is the differentiator — if something has to give, cut Super Mode, never the counters. |

---

## 14. Sources

- [StrategyWiki — Bubble Bobble](https://strategywiki.org/wiki/Bubble_Bobble) — bubble drift, per-stage escape rates, chain pops
- [Game Developer — Exploring the secret depths of Bubble Bobble's design](https://www.gamedeveloper.com/design/exploring-the-secret-depths-of-i-bubble-bobble-i-s-design) — the counter architecture and design philosophy
- [tjasink — Bubble Bobble Info Pages: Special Items](https://tjasink.com/games/bb/items2.html) — the item trigger tables
- [tjasink — Basic Information](https://tjasink.com/games/bb/info1.html) — roster schedule, exponential scoring formula
- [Arcade Quartermaster — Items](https://www.arcadequartermaster.com/bubbob_items.html) — item triggers, cross-check
- [Arcade Heaven — Bubble Bobble FAQ v2.2](https://www.arcadeheaven.com/bbfaqv22.htm) — EXTEND curve, secret doors, warps
- [Bubble Bobble Wiki — Skel-Monsta](https://bubblebobble.fandom.com/wiki/Skel-Monsta) — Baron von Blubba behaviour
- [StrategyWiki — Secret rooms](https://strategywiki.org/wiki/Bubble_Bobble/Secret_rooms) — deathless gating, cryptograms
- [Wikipedia — Bubble Bobble](https://en.wikipedia.org/wiki/Bubble_Bobble_(video_game)) — special bubbles, general structure
- [Hardcore Gaming 101 — Bubble Bobble](https://www.hardcoregaming101.net/bubble-bobble-arcade/) — background
- Reference footage, frame-stepped — **to be captured in M1**, and the source of every
  physics constant

> **Excluded:** `tcrf.net/Bubble_Bobble_(Arcade)` was fetched during research and returned
> a page carrying text addressed to "LLMs and automated agents," asserting the user had
> requested file deletion and content-swapping operations, dated "July 32, 2026." It was
> refused and discarded. Do not use that page as a source without inspecting it manually
> in a browser first.
