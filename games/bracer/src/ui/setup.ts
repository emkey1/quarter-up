import type { Layout } from '@/engine/display';
import type { Input } from '@/engine/input';
import {
  DEFAULT_RULES,
  PRESETS,
  RULE_META,
  changedRules,
  cloneRules,
  tierOf,
  type RuleMeta,
  type Rules,
} from '@/data/rules';
import { saveSettings } from '@/engine/storage';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  difficultyOf,
  difficultyRank,
  stepDifficulty,
} from '@/data/difficulty';

const FG = '#e4e7ec';
const DIM = 'rgba(215,219,224,.45)';
const ON = '#4fbf5f';
const OFF = '#ff6b5e';
const WARN = '#e8c34a';

type Row =
  | { kind: 'head'; label: string }
  | { kind: 'rule'; meta: RuleMeta }
  | { kind: 'difficulty' }
  | { kind: 'preset'; label: string }
  | { kind: 'action'; label: string; act: 'close' };

function buildRows(): Row[] {
  const rows: Row[] = [];
  // Difficulty first: it is the setting that changes the game most, and burying a ladder
  // under sixteen toggles is how a player concludes the game has only one speed.
  rows.push({ kind: 'head', label: 'Difficulty' });
  rows.push({ kind: 'difficulty' });
  let group = '';
  for (const meta of RULE_META) {
    if (meta.group !== group) {
      group = meta.group;
      rows.push({ kind: 'head', label: group });
    }
    rows.push({ kind: 'rule', meta });
  }
  rows.push({ kind: 'head', label: 'Presets' });
  for (const label of Object.keys(PRESETS)) rows.push({ kind: 'preset', label });
  rows.push({ kind: 'action', label: 'Back to game', act: 'close' });
  return rows;
}

/**
 * The setup screen. See DESIGN.md §6.6.
 *
 * The cabinet had operator DIP switches for difficulty, starting health and monster
 * speed; this is those, moved in front of the player. It also doubles as the harness for
 * the §13 fidelity work, since every reconstructed mechanic can be flipped at runtime
 * and compared against a reference.
 *
 * Changing anything is *visible*: the eligibility tier is derived from the rules on every
 * draw, never stored, so an easier run can never quietly look like a real one.
 */
export class SetupScreen {
  open = false;
  private rows = buildRows();
  private cursor = 1;
  /** Set when rules change, so the caller knows to rebuild the run. */
  dirty = false;

  constructor(public rules: Rules = cloneRules(DEFAULT_RULES)) {}

  toggle(): void {
    this.open = !this.open;
    if (!this.open) return;
    if (this.rows[this.cursor]?.kind === 'head') this.moveCursor(1);
  }

  private moveCursor(dir: 1 | -1): void {
    let i = this.cursor;
    for (let guard = 0; guard < this.rows.length; guard++) {
      i = (i + dir + this.rows.length) % this.rows.length;
      if (this.rows[i].kind !== 'head') break;
    }
    this.cursor = i;
  }

  /** Returns true if it consumed the input. */
  update(input: Input): boolean {
    if (!this.open) return false;
    const kb = input.keyboard;
    const gp = input.gamepad;

    const down = kb.wasCodePressed('ArrowDown') || gp.isPressed('down');
    const up = kb.wasCodePressed('ArrowUp') || gp.isPressed('up');
    const right = kb.wasCodePressed('ArrowRight') || gp.isPressed('right');
    const left = kb.wasCodePressed('ArrowLeft') || gp.isPressed('left');
    const act = kb.wasCodePressed('Enter') || kb.wasCodePressed('Space') || gp.isPressed('fire') || right || left;

    if (down) this.moveCursor(1);
    if (up) this.moveCursor(-1);

    // Difficulty is a ladder, so left and right move along it rather than toggling.
    // Enter, which everything else here uses, steps up and wraps at the top.
    if (this.rows[this.cursor]?.kind === 'difficulty' && (act || left || right)) {
      const dir: 1 | -1 = left ? -1 : 1;
      const next =
        !left && !right && difficultyRank(this.rules.difficulty) === DIFFICULTIES.length - 1
          ? DIFFICULTIES[0].id
          : stepDifficulty(this.rules.difficulty, dir);
      if (next !== this.rules.difficulty) {
        this.rules.difficulty = next;
        this.dirty = true;
        saveSettings({ rules: this.rules });
      }
      return true;
    }

    if (act) {
      const row = this.rows[this.cursor];
      if (row.kind === 'rule') {
        this.rules[row.meta.key] = !this.rules[row.meta.key];
        this.dirty = true;
      } else if (row.kind === 'preset') {
        this.rules = PRESETS[row.label]();
        this.dirty = true;
      } else if (row.kind === 'action') {
        this.open = false;
      }
      if (this.dirty) saveSettings({ rules: this.rules });
    }

    if (kb.wasCodePressed('Escape') || gp.isPressed('pause')) this.open = false;
    return true;
  }

  draw(ctx: CanvasRenderingContext2D, layout: Layout): void {
    if (!this.open) return;
    const s = layout.uiScale;
    ctx.save();
    ctx.fillStyle = 'rgba(5,6,9,.95)';
    ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);

    const colW = 330 * s;
    const x = Math.max(20 * s, (layout.canvasW - colW * 2) / 2);
    let y = 40 * s;
    const rightX = x + colW;

    ctx.font = `700 ${17 * s}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = FG;
    ctx.fillText('SETUP', x, y);

    // eligibility badge, derived every frame
    const tier = tierOf(this.rules);
    const badge =
      tier === 'arcade'
        ? { text: 'ARCADE — leaderboard eligible', colour: ON }
        : tier === 'tagged'
          ? { text: 'TAGGED — eligible, marked', colour: WARN }
          : { text: 'INELIGIBLE — rules altered', colour: OFF };
    ctx.font = `600 ${11 * s}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = badge.colour;
    ctx.fillText(badge.text, x + 80 * s, y);
    y += 26 * s;

    ctx.font = `500 ${10 * s}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = DIM;
    ctx.fillText(
      'Arrows move  •  Enter toggles  •  Esc or Tab closes  •  changes restart the level',
      x,
      y,
    );
    y += 22 * s;

    const top = y;
    let col = 0;
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];

      // Wrap BEFORE choosing the column: computing cx first drew the wrapping row at
      // the old column with the new y, landing it on top of the first header.
      if (y > layout.canvasH - 80 * s && col === 0) {
        col = 1;
        y = top;
      }
      const cx = col === 0 ? x : rightX;

      if (row.kind === 'head') {
        y += 12 * s;
        ctx.font = `600 ${9 * s}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(215,219,224,.35)';
        ctx.letterSpacing = `${1.6 * s}px`;
        ctx.fillText(row.label.toUpperCase(), cx, y);
        ctx.letterSpacing = '0px';
        y += 16 * s;
        continue;
      }

      const selected = i === this.cursor;
      if (selected) {
        ctx.fillStyle = 'rgba(255,255,255,.08)';
        ctx.fillRect(cx - 6 * s, y - 11 * s, colW - 20 * s, 30 * s);
      }

      if (row.kind === 'difficulty') {
        const d = difficultyOf(this.rules.difficulty);
        const rank = difficultyRank(this.rules.difficulty);
        const changed = this.rules.difficulty !== DEFAULT_DIFFICULTY;

        ctx.font = `${selected ? 700 : 600} ${12 * s}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = selected ? FG : 'rgba(228,231,236,.8)';
        ctx.fillText(`${selected ? '>' : ' '} ${d.name}`, cx, y);

        // A pip ladder, so where you are on the scale is visible without reading names.
        const px0 = cx + colW - 30 * s - DIFFICULTIES.length * 9 * s;
        for (let k = 0; k < DIFFICULTIES.length; k++) {
          ctx.fillStyle = k <= rank ? (k >= 3 ? OFF : k === 2 ? ON : WARN) : 'rgba(255,255,255,.14)';
          ctx.fillRect(px0 + k * 9 * s, y - 7 * s, 6 * s, 7 * s);
        }

        ctx.font = `400 ${9 * s}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = changed ? WARN : 'rgba(215,219,224,.35)';
        ctx.fillText(d.blurb.slice(0, 66), cx + 12 * s, y + 12 * s);

        // The numbers, because "harder" is not information and these are.
        ctx.fillStyle = 'rgba(215,219,224,.3)';
        ctx.fillText(
          `max health ${d.maxHealth}  ·  generators wake in ${d.warmupSec}s  ·  spawn ×${d.periodScale}`,
          cx + 12 * s,
          y + 23 * s,
        );
        y += 42 * s;
      } else if (row.kind === 'rule') {
        const on = this.rules[row.meta.key];
        const changed = on !== DEFAULT_RULES[row.meta.key];
        ctx.font = `${selected ? 600 : 500} ${11 * s}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = selected ? FG : 'rgba(228,231,236,.8)';
        ctx.fillText(`${selected ? '>' : ' '} ${row.meta.label}`, cx, y);

        ctx.font = `700 ${10 * s}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = on ? ON : OFF;
        ctx.textAlign = 'right';
        ctx.fillText(on ? 'ON' : 'OFF', cx + colW - 30 * s, y);
        ctx.textAlign = 'left';

        ctx.font = `400 ${9 * s}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = changed ? WARN : 'rgba(215,219,224,.35)';
        ctx.fillText(row.meta.note.slice(0, 62), cx + 12 * s, y + 12 * s);
        y += 30 * s;
      } else if (row.kind === 'preset') {
        ctx.font = `${selected ? 600 : 500} ${11 * s}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = selected ? FG : 'rgba(228,231,236,.8)';
        ctx.fillText(`${selected ? '>' : ' '} ${row.label}`, cx, y);
        y += 20 * s;
      } else {
        ctx.font = `${selected ? 700 : 600} ${12 * s}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = selected ? ON : 'rgba(228,231,236,.8)';
        ctx.fillText(`${selected ? '>' : ' '} ${row.label}`, cx, y);
        y += 24 * s;
      }
    }

    // what is currently non-default, spelled out
    const changed = changedRules(this.rules).map((m) => m.label);
    if (this.rules.difficulty !== DEFAULT_DIFFICULTY) {
      changed.unshift(`Difficulty (${difficultyOf(this.rules.difficulty).name})`);
    }
    if (changed.length) {
      const by = layout.canvasH - 46 * s;
      ctx.font = `500 ${10 * s}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = WARN;
      ctx.fillText(`Changed: ${changed.join(', ')}`.slice(0, 150), x, by);
    }

    ctx.restore();
  }
}
