import type { Audio } from '@/engine/audio';
import type { Speech } from '@/engine/speech';
import type { GameEvent } from '@/game/events';
import type { World } from '@/game/world';
import { FX_COLOURS, Particles } from '@/render/particles';
import type { ScreenFx } from '@/render/fx';
import type { Light } from '@/render/lighting';
import { Announcer } from './announcer';
import { CLASSES } from '@/data/classes';
import { T } from '@/data/tuning';

/**
 * Turns simulation events into sound, particles and screen feedback.
 *
 * All of it is one-way. The simulation emits and forgets; nothing here can influence a
 * later step, so dropping every effect (reduced motion, muted, no voices) leaves the
 * game bit-identical. That is what makes it safe to be generous with the feedback.
 */
export class Presentation {
  readonly particles = new Particles();
  readonly announcer = new Announcer();
  private levelStartFrame = 0;

  constructor(
    private readonly audio: Audio,
    private readonly speech: Speech,
    private readonly fx: ScreenFx,
  ) {}

  onNewLevel(world: World): void {
    this.particles.clear();
    this.announcer.newLevel();
    this.levelStartFrame = world.frame;
    this.audio.play('levelStart');
  }

  /** Drain one frame of events. */
  consume(world: World): void {
    const events = world.events.drain();
    for (const e of events) this.handle(e, world);

    const p = world.player;
    const cls = CLASSES[p.classId];
    const line = this.announcer.update(
      {
        className: cls.name,
        health: p.health,
        frame: world.frame,
        levelStarted: world.frame - this.levelStartFrame < 4 * T.STEP_HZ,
        hasHiddenUpgrade: world.hasHiddenUpgrade,
        deathOnScreen: world.deaths.some((d) => d.alive && world.camera.contains(d.x, d.y)),
        thiefPresent: world.thieves.some((t) => t.alive),
        dead: p.dead,
      },
      events,
    );
    if (line) this.speech.say(line.text);

    this.particles.update();
    this.fx.update();
  }

  private handle(e: GameEvent, world: World): void {
    const A = this.audio;
    switch (e.t) {
      case 'shotFired':
        A.play('shot', 40);
        break;

      case 'shotHitWall':
        A.play('shotWall', 30);
        this.particles.spawn(e.x, e.y, 3, {
          speed: 0.8,
          life: 10,
          size: 1.5,
          colours: [...FX_COLOURS.spark],
        });
        break;

      case 'melee':
        A.play('melee', 60);
        break;

      case 'monsterHurt':
        this.particles.spawn(e.x, e.y, 3, {
          speed: 1,
          life: 12,
          size: 1.5,
          colours: [...FX_COLOURS.blood],
        });
        break;

      case 'monsterKilled': {
        const ghost = e.kind === 'ghost';
        A.play(ghost ? 'ghostDie' : 'monsterDie', 25);
        this.particles.spawn(e.x, e.y, 10 + e.level * 4, {
          speed: 1.6,
          life: 26,
          size: 2,
          colours: [...(ghost ? FX_COLOURS.ghost : FX_COLOURS.monster)],
          gravity: ghost ? -0.02 : 0.03,
        });
        break;
      }

      case 'generatorHurt':
        A.play('generatorHit', 40);
        this.particles.spawn(e.x, e.y, 5, {
          speed: 1.4,
          life: 16,
          size: 2,
          colours: [...FX_COLOURS.dust],
          gravity: 0.05,
        });
        break;

      case 'generatorDestroyed':
        A.play('generatorDie');
        this.fx.addShake(4);
        this.fx.addPunch(0.7);
        this.particles.spawn(e.x, e.y, 34, {
          speed: 2.6,
          life: 40,
          size: 2.6,
          colours: [...FX_COLOURS.generator],
          gravity: 0.06,
        });
        break;

      case 'spawned':
        A.play('spawn', 90);
        this.particles.spawn(e.x, e.y, 4, {
          speed: 0.7,
          life: 14,
          size: 1.5,
          colours: [...FX_COLOURS.magic],
        });
        break;

      case 'playerHurt':
        A.play('hurt', 90);
        this.fx.addVignette(Math.min(0.7, e.amount / 40));
        this.fx.addShake(Math.min(3, e.amount / 12));
        this.particles.spawn(e.x, e.y, 5, {
          speed: 1.2,
          life: 14,
          size: 2,
          colours: [...FX_COLOURS.blood],
        });
        break;

      case 'playerDied':
        A.play('die');
        this.fx.addShake(8);
        this.fx.addFlash(0.5, '#ff3020');
        break;

      case 'magic':
        A.play('potion');
        this.fx.addFlash(0.9);
        this.fx.addShake(6);
        this.particles.spawn(world.player.x, world.player.y, 60, {
          speed: 4,
          life: 46,
          size: 2.4,
          colours: [...FX_COLOURS.magic],
        });
        break;

      case 'pickup': {
        const map: Record<string, Parameters<Audio['play']>[0]> = {
          food: 'pickupFood',
          key: 'pickupKey',
          treasure: 'pickupTreasure',
          potion: 'pickupPotion',
          upgrade: 'upgrade',
        };
        A.play(map[e.kind] ?? 'pickupTreasure');
        if (e.kind === 'upgrade') {
          this.fx.addFlash(0.35, '#c88cff');
          this.particles.spawn(e.x, e.y, 30, {
            speed: 2,
            life: 42,
            size: 2.4,
            colours: [...FX_COLOURS.magic],
          });
        } else {
          this.particles.spawn(e.x, e.y, 8, {
            speed: 1.1,
            life: 22,
            size: 1.8,
            colours: [...FX_COLOURS.pickup],
            gravity: -0.03,
          });
        }
        break;
      }

      case 'foodDestroyed':
        // Deliberately harsh. Shooting the food should feel like a mistake.
        A.play('monsterDie');
        this.fx.addShake(2);
        this.particles.spawn(e.x, e.y, 14, {
          speed: 1.8,
          life: 26,
          size: 2,
          colours: [...FX_COLOURS.dust],
          gravity: 0.08,
        });
        break;

      case 'doorsOpened':
        A.play('door');
        break;

      case 'trapTriggered':
        A.play('door');
        this.fx.addShake(3);
        break;

      case 'teleported':
        A.play('teleport');
        this.particles.spawn(e.x, e.y, 22, {
          speed: 2.2,
          life: 30,
          size: 2,
          colours: [...FX_COLOURS.magic],
        });
        break;

      case 'wallsBecameExits':
        A.play('exitOpen');
        this.fx.addFlash(0.4, '#6ff08a');
        break;

      case 'exitReached':
        A.play('exit');
        this.fx.addFlash(0.22, '#9fe8ff');
        break;

      case 'treasureForfeited':
        // Losing a haul to the clock must not look like leaving with one. Red, a shake,
        // and the number said out loud, so the lesson is unmistakable the first time.
        A.play('thiefSteal');
        this.fx.addFlash(0.5, '#ff4a3a');
        this.fx.addShake(4);
        // say() captions as well as speaks, so this is legible with the sound off.
        this.speech.say(`Out of time! ${e.score} points lost.`);
        break;

      case 'deathVanished':
        A.play('ghostDie');
        this.particles.spawn(e.x, e.y, 26, {
          speed: 2.2,
          life: 40,
          size: 2.4,
          colours: [...FX_COLOURS.magic],
        });
        break;

      case 'thiefStole':
        A.play('thiefSteal');
        this.fx.addShake(3);
        break;

      case 'thiefKilled':
        A.play('pickupTreasure');
        this.particles.spawn(e.x, e.y, 20, {
          speed: 2,
          life: 32,
          size: 2,
          colours: [...FX_COLOURS.pickup],
          gravity: 0.05,
        });
        break;

      default:
        break;
    }
  }

  /** Light sources for this frame, in screen pixels. */
  collectLights(
    world: World,
    toX: (wx: number) => number,
    toY: (wy: number) => number,
    px: number,
  ): Light[] {
    const lights: Light[] = [];
    const p = world.player;
    lights.push({ x: toX(p.x), y: toY(p.y), radius: 90 * px * 0.5, strength: 0.95 });

    for (const g of world.generators) {
      if (!g.alive) continue;
      // Brightens as the spawn timer fills: pressure you can see coming.
      lights.push({
        x: toX(g.x),
        y: toY(g.y),
        radius: (26 + g.charge * 26) * px * 0.5,
        strength: 0.35 + g.charge * 0.5,
      });
    }
    for (const pr of world.projectiles) {
      if (!pr.alive) continue;
      lights.push({ x: toX(pr.x), y: toY(pr.y), radius: 26 * px * 0.5, strength: 0.7 });
    }
    for (const it of world.items) {
      if (!it.alive) continue;
      if (it.kind === 'upgrade') {
        lights.push({ x: toX(it.x), y: toY(it.y), radius: 40 * px * 0.5, strength: 0.7 });
      } else if (it.kind === 'potion') {
        lights.push({ x: toX(it.x), y: toY(it.y), radius: 24 * px * 0.5, strength: 0.45 });
      }
    }
    for (const d of world.deaths) {
      if (d.alive) {
        lights.push({ x: toX(d.x), y: toY(d.y), radius: 44 * px * 0.5, strength: 0.6 });
      }
    }
    return lights;
  }
}
