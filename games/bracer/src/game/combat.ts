import { T } from '@/data/tuning';
import type { EventBus, KillSource } from './events';
import type { Generator } from './generator';
import type { Monster } from './monster';
import type { Player } from './player';

/**
 * Damage the player, after armour.
 *
 * Armour is a straight percentage reduction, so the Valkyrie's 30% is worth roughly a
 * third more effective health than the Wizard's 0% — and the Wizard's total lack of it
 * is why he cannot afford to be touched.
 *
 * Death (the monster) ignores armour entirely; callers pass `ignoreArmor` for it.
 */
export function damagePlayer(
  p: Player,
  raw: number,
  events: EventBus,
  ignoreArmor = false,
): number {
  if (p.invulnFrames > 0 || p.dead) return 0;
  const armor = ignoreArmor ? 0 : p.stats.armor;
  const dealt = Math.max(1, Math.round(raw * (1 - armor)));
  p.health -= dealt;
  p.damageFlash = 8;
  events.emit({ t: 'playerHurt', amount: dealt, x: p.x, y: p.y });
  if (p.health <= 0) {
    p.health = 0;
    events.emit({ t: 'playerDied' });
  }
  return dealt;
}

export function damageMonster(
  m: Monster,
  amount: number,
  by: KillSource,
  events: EventBus,
  score: (n: number, reason: string) => void,
): boolean {
  if (!m.alive || amount <= 0) return false;
  m.hp -= amount;
  m.hurtFlash = 5;
  if (m.hp > 0) {
    events.emit({ t: 'monsterHurt', x: m.x, y: m.y });
    return false;
  }
  m.alive = false;
  events.emit({ t: 'monsterKilled', kind: m.kind, level: m.level, x: m.x, y: m.y, by });
  score(scoreForKill(m, by), `${by} ${m.kind}`);
  return true;
}

/**
 * Kill scoring, per DESIGN.md §3.6. Melee is worth far more than shooting (25 flat vs
 * 5-10), which is the game quietly paying you for taking the risk of standing in
 * contact range.
 */
export function scoreForKill(m: Monster, by: KillSource): number {
  if (by === 'melee') return T.SCORE.meleeKill;
  if (by === 'magic') return T.SCORE.magicKill;
  if (by === 'contact') return 0; // a ghost destroying itself on you is not a reward
  return (m.kind === 'ghost' ? T.SCORE.ghostPerLevel : T.SCORE.monsterPerLevel) * m.level;
}

export function damageGenerator(
  g: Generator,
  amount: number,
  events: EventBus,
  score: (n: number, reason: string) => void,
): boolean {
  if (!g.alive || amount <= 0) return false;
  const before = g.level;
  g.level -= amount;
  g.hurtFlash = 6;
  if (g.level > 0) {
    events.emit({ t: 'generatorHurt', x: g.x, y: g.y, level: g.level });
    return false;
  }
  g.alive = false;
  events.emit({ t: 'generatorDestroyed', x: g.x, y: g.y, kind: g.kind });
  score(T.SCORE.generatorPerLevel * before, 'generator');
  return true;
}
