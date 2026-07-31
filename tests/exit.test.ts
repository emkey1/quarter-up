import { describe, it, expect } from 'vitest';
import { T } from '@/data/tuning';
import { CAMPAIGN } from '@/data/campaign';
import { World } from '@/game/world';
import { Run } from '@/game/flow';
import { Tile } from '@/game/terrain';
import { cellCentre } from '@/game/level';
import { emptyActions } from '@/engine/actions';
import { DEFAULT_RULES, cloneRules } from '@/data/rules';

/** Drop the player onto the level's first exit tile and step once to trigger it. */
function atExit(levelIndex = 0): World {
  const w = new World(CAMPAIGN[levelIndex], 'elf', 1);
  const [cx, cy] = w.terrain.cellsOf(Tile.Exit)[0];
  const [x, y] = cellCentre(cx, cy);
  w.player.x = x;
  w.player.y = y;
  w.step(emptyActions());
  return w;
}

describe('the exit sequence', () => {
  it('does not end the level on the frame you touch the exit', () => {
    const w = atExit();
    expect(w.exitFrames).toBeGreaterThanOrEqual(0);
    expect(w.exitReached, 'the level ended instantly, with no send-off').toBe(false);
  });

  it('ends it once the sequence has run', () => {
    const w = atExit();
    for (let i = 0; i < T.EXIT_SEQUENCE_F + 2; i++) w.step(emptyActions());
    expect(w.exitReached).toBe(true);
    expect(w.exitProgress).toBe(1);
  });

  it('reports progress from 0 to 1, monotonically', () => {
    const w = atExit();
    let prev = -1;
    for (let i = 0; i < T.EXIT_SEQUENCE_F; i++) {
      const p = w.exitProgress;
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p).toBeLessThanOrEqual(1);
      prev = p;
      w.step(emptyActions());
    }
  });

  it('draws the player to the centre of the exit tile', () => {
    // So the sprite always ends up dead centre in the portal, wherever on the tile the
    // player happened to cross the threshold.
    const w = new World(CAMPAIGN[0], 'elf', 1);
    const [cx, cy] = w.terrain.cellsOf(Tile.Exit)[0];
    const [ex, ey] = cellCentre(cx, cy);
    w.player.x = ex + 5;
    w.player.y = ey + 5;
    for (let i = 0; i < T.EXIT_SEQUENCE_F; i++) w.step(emptyActions());
    expect(Math.abs(w.player.x - ex)).toBeLessThan(1);
    expect(Math.abs(w.player.y - ey)).toBeLessThan(1);
  });

  it('makes the player untouchable while it plays', () => {
    // The level is over the moment you touch the exit. Dying during your own victory
    // animation would be the worst possible outcome of adding one.
    const w = atExit();
    const before = w.player.health;
    for (let i = 0; i < T.EXIT_SEQUENCE_F; i++) w.step(emptyActions());
    expect(w.player.health, 'the drain kept running during the exit').toBe(before);
    expect(w.player.dead).toBe(false);
  });

  it('freezes the rest of the world too', () => {
    const lvl = CAMPAIGN.findIndex((l) => l.objects.some((o) => o.t === 'gen'));
    const w = atExit(lvl);
    const monsters = w.liveMonsters;
    for (let i = 0; i < T.EXIT_SEQUENCE_F; i++) w.step(emptyActions());
    expect(w.liveMonsters, 'a generator spawned during the exit sequence').toBe(monsters);
  });

  it('only fires once, however long you stand on the tile', () => {
    const w = atExit();
    const started = w.exitFrames;
    w.step(emptyActions());
    expect(w.exitFrames).toBe(started + 1);
  });

  it('still advances the run, just later', () => {
    const r = new Run(CAMPAIGN, 'elf', 1, 0, cloneRules(DEFAULT_RULES), 7);
    const [cx, cy] = r.world.terrain.cellsOf(Tile.Exit)[0];
    const [x, y] = cellCentre(cx, cy);
    r.world.player.x = x;
    r.world.player.y = y;

    // Run.step() only reacts to the world; the play screen is what advances it.
    for (let i = 0; i < T.EXIT_SEQUENCE_F + 4 && r.depth === 1; i++) {
      r.world.step(emptyActions());
      r.step();
    }
    expect(r.depth, 'the run never advanced past the exit sequence').toBe(2);
  });

  it('gives the exit a position for the renderer to converge on', () => {
    const w = atExit();
    expect(w.exitAt).not.toBeNull();
    const [cx, cy] = w.terrain.cellsOf(Tile.Exit)[0];
    expect(w.exitAt).toEqual(cellCentre(cx, cy));
  });
});
