import { byFamily } from './stats';
import { damageGenerator, damageMonster } from './combat';
import type { EventBus } from './events';
import { family, type Generator } from './generator';
import { familyOf, type Monster } from './monster';
import type { Player } from './player';
import type { Camera } from './camera';

export type MagicSource = 'used' | 'shot';

/**
 * Potion detonation.
 *
 * Scoped to the *viewport*, not the level — that is the "smart bomb clears the screen"
 * behaviour, and another reason the 232x240 gameplay window is a gameplay constant
 * rather than a presentation one (DESIGN.md §6.1).
 *
 * The class split here is the single biggest balance fact in Gauntlet: the Wizard does
 * 3 damage to generators and the Warrior does 0, so the same item is a room-clearing
 * reset for one character and a mild inconvenience to monsters for another.
 */
export function detonate(
  player: Player,
  source: MagicSource,
  monsters: readonly Monster[],
  generators: readonly Generator[],
  camera: Camera,
  events: EventBus,
  score: (n: number, reason: string) => void,
): void {
  const st = player.stats;
  const vsMon = source === 'used' ? st.magicVsMonsters : st.potionShotVsMonsters;
  const vsGen = source === 'used' ? st.magicVsGenerators : st.potionShotVsGenerators;

  let strongest = 0;

  for (const m of monsters) {
    if (!m.alive || !camera.contains(m.x, m.y)) continue;
    const dmg = byFamily(vsMon, familyOf(m.kind));
    strongest = Math.max(strongest, dmg);
    damageMonster(m, dmg, 'magic', events, score);
  }

  for (const g of generators) {
    if (!g.alive || !camera.contains(g.x, g.y)) continue;
    const fam = family(g);
    let dmg = byFamily(vsGen, fam);
    // The Valkyrie's magic bites an extra point out of block-family generators and
    // their spawn — her one meaningful magical advantage.
    if (player.classId === 'valkyrie' && fam === 'block') dmg += 1;
    strongest = Math.max(strongest, dmg);
    damageGenerator(g, dmg, events, score);
  }

  events.emit({ t: 'magic', strength: strongest });
}
