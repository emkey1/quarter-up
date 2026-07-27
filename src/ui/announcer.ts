import type { GameEvent } from '@/game/events';

/**
 * The narrator.
 *
 * The cabinet's TMS5220C shouting "Warrior needs food badly!" is the single most quoted
 * thing about Gauntlet, and it is not decoration: it is the game telling you the one
 * fact that matters when you are too busy to read a number.
 *
 * The trigger rules live here as pure logic with no DOM and no clock of their own, so
 * they can be tested exhaustively. Speaking them is somebody else's problem (speech.ts).
 */

export type LinePriority = 'critical' | 'warning' | 'flavour';

export interface Line {
  text: string;
  priority: LinePriority;
  /** Distinct lines with the same tag suppress each other's repeats. */
  tag: string;
}

export interface AnnouncerState {
  className: string;
  health: number;
  /** Frames elapsed; the announcer keeps no wall clock of its own. */
  frame: number;
  levelStarted: boolean;
  hasHiddenUpgrade: boolean;
  deathOnScreen: boolean;
  thiefPresent: boolean;
}

const SEC = 60;

/** How often a still-true warning may repeat itself. */
const REPEAT_FRAMES: Record<string, number> = {
  needsFood: 15 * SEC,
  aboutToDie: 10 * SEC,
  death: 20 * SEC,
  thief: 20 * SEC,
};

export const LOW_HEALTH = 200;
export const CRITICAL_HEALTH = 100;

export class Announcer {
  private lastSaid = new Map<string, number>();
  private prevHealth = Infinity;
  private saidThisLevel = new Set<string>();
  private flavourSaidThisLevel = false;

  reset(): void {
    this.lastSaid.clear();
    this.saidThisLevel.clear();
    this.flavourSaidThisLevel = false;
    this.prevHealth = Infinity;
  }

  /**
   * A new level is a fresh context, so ALL cooldowns clear — including the one-shot
   * tags. Clearing only the per-level set left every one-shot line permanently spent,
   * so "a potion lies hidden here" could be said on level one and never again.
   */
  newLevel(): void {
    this.lastSaid.clear();
    this.saidThisLevel.clear();
    this.flavourSaidThisLevel = false;
  }

  private canSay(tag: string, frame: number): boolean {
    const gap = REPEAT_FRAMES[tag];
    const last = this.lastSaid.get(tag);
    if (last === undefined) return true;
    if (gap === undefined) return false; // one-shot tags never repeat
    return frame - last >= gap;
  }

  private mark(tag: string, frame: number): void {
    this.lastSaid.set(tag, frame);
  }

  /**
   * Decide what, if anything, to say this frame.
   *
   * Returns at most one line. Silence is the normal answer — a narrator that talks
   * constantly stops being information and becomes noise.
   */
  update(s: AnnouncerState, events: readonly GameEvent[]): Line | null {
    const out: Line[] = [];

    for (const e of events) {
      switch (e.t) {
        case 'foodDestroyed':
          out.push({
            text: `${s.className} shot the food!`,
            priority: 'warning',
            tag: 'shotFood',
          });
          break;
        case 'playerDied':
          out.push({ text: `${s.className} has died.`, priority: 'critical', tag: 'died' });
          break;
        case 'thiefStole':
          out.push({ text: 'The thief has your treasure!', priority: 'warning', tag: 'stole' });
          break;
        case 'upgradeTaken':
          out.push({ text: `${s.className} grows stronger.`, priority: 'flavour', tag: 'upgrade' });
          break;
        case 'wallsBecameExits':
          out.push({ text: 'The walls give way.', priority: 'flavour', tag: 'walls' });
          break;
        default:
          break;
      }
    }

    // --- health warnings. Critical outranks low, and neither repeats more often than
    // its cooldown, so a long fight does not become a lecture.
    if (s.health < CRITICAL_HEALTH) {
      out.push({
        text: `${s.className} is about to die!`,
        priority: 'critical',
        tag: 'aboutToDie',
      });
    } else if (s.health < LOW_HEALTH) {
      out.push({
        text: `${s.className} needs food badly!`,
        priority: 'warning',
        tag: 'needsFood',
      });
    }

    if (s.deathOnScreen) {
      out.push({ text: 'Death is upon you.', priority: 'warning', tag: 'death' });
    }
    if (s.thiefPresent) {
      out.push({ text: 'Beware — the thief approaches!', priority: 'warning', tag: 'thief' });
    }

    // --- per-level flavour: at most ONE line per level, ever. Chaining two of them at
    // level start is chatter, and chatter is how a narrator stops being information.
    if (s.levelStarted && !this.flavourSaidThisLevel) {
      if (s.hasHiddenUpgrade) {
        out.push({ text: 'A potion lies hidden here.', priority: 'flavour', tag: 'hidden' });
      } else if (s.frame < 3 * SEC) {
        out.push({
          text: "Remember, don't shoot the food.",
          priority: 'flavour',
          tag: 'dontShoot',
        });
      }
    }

    if (!out.length) return null;

    out.sort((a, b) => rank(b.priority) - rank(a.priority));
    for (const line of out) {
      if (!this.canSay(line.tag, s.frame)) continue;
      this.mark(line.tag, s.frame);
      this.saidThisLevel.add(line.tag);
      if (line.priority === 'flavour') this.flavourSaidThisLevel = true;
      return line;
    }
    return null;
  }

  /** Health crossing detector, kept for callers that want edge behaviour. */
  crossedBelow(threshold: number, health: number): boolean {
    const crossed = this.prevHealth >= threshold && health < threshold;
    this.prevHealth = health;
    return crossed;
  }
}

function rank(p: LinePriority): number {
  return p === 'critical' ? 2 : p === 'warning' ? 1 : 0;
}
