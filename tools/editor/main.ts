import { T } from '@/data/tuning';
import { validateLevel, type LevelData, type LevelObject } from '@/game/level';
import { analyseLevel } from '@/game/analyse';
import { CAMPAIGN } from '@/data/campaign';
import { UPGRADES } from '@/data/classes';
import { PLAYTEST_KEY } from '@/playtest';

/**
 * The level editor.
 *
 * DESIGN.md §11 calls this a milestone rather than a stretch goal, and the reason is
 * feedback latency: the difference between shipping good levels and mediocre ones is
 * how quickly you find out that a room is sealed, an item is buried, or the exit cannot
 * be reached. So the validator runs on every single edit and its result is always on
 * screen — you never have to ask whether the level is broken.
 *
 * It reads and writes the same JSON the game loads, so anything authored here drops
 * straight into the campaign.
 */

const N = T.GRID;
const CELL = 22;

/* ------------------------------------------------------------------ palette */

interface Brush {
  key: string;
  label: string;
  colour: string;
  /** A terrain glyph, or an object type to place. */
  glyph?: string;
  obj?: string;
}

const TERRAIN: Brush[] = [
  { key: 'floor', label: 'Floor', colour: '#4a382c', glyph: '.' },
  { key: 'wall', label: 'Wall', colour: '#3f6f9f', glyph: 'X' },
  { key: 'breakable', label: 'Breakable wall', colour: '#8a7a4a', glyph: 'x' },
  { key: 'door', label: 'Door', colour: '#b98a3a', glyph: 'D' },
  { key: 'exit', label: 'Exit', colour: '#4fbf5f', glyph: 'E' },
  { key: 'tele', label: 'Teleporter', colour: '#a05cd0', glyph: '@' },
  { key: 'trap', label: 'Trap tile', colour: '#7a6a5a', glyph: '^' },
  { key: 'void', label: 'Void', colour: '#101218', glyph: ' ' },
];

const OBJECTS: Brush[] = [
  { key: 'start', label: 'Player start', colour: '#ffffff', obj: 'start' },
  { key: 'food', label: 'Food', colour: '#7fc45a', obj: 'food' },
  { key: 'key', label: 'Key', colour: '#e8c860', obj: 'key' },
  { key: 'potion', label: 'Potion', colour: '#6bc8f5', obj: 'potion' },
  { key: 'treasure', label: 'Treasure', colour: '#b8862c', obj: 'treasure' },
  { key: 'upgrade', label: 'Upgrade potion', colour: '#c88cff', obj: 'upgrade' },
  { key: 'gen', label: 'Generator', colour: '#ff8b3c', obj: 'gen' },
  { key: 'mon', label: 'Monster', colour: '#4f9d4f', obj: 'mon' },
  { key: 'death', label: 'Death', colour: '#d24bff', obj: 'death' },
  { key: 'thief', label: 'Thief', colour: '#8a84c0', obj: 'thief' },
  { key: 'erase', label: 'Erase object', colour: '#ff6b5e', obj: 'erase' },
];

const MONSTER_KINDS = ['ghost', 'grunt', 'demon', 'sorcerer', 'lobber'];

/** One letter per object type, drawn on its marker. */
const GLYPH_FOR: Record<string, string> = {
  food: 'F',
  key: 'K',
  potion: 'P',
  treasure: 'T',
  upgrade: 'U',
  gen: 'G',
  mon: 'M',
  death: 'D',
  thief: '$',
};

/* ------------------------------------------------------------------ state */

function emptyLevel(): LevelData {
  const rows: string[] = [];
  for (let y = 0; y < N; y++) {
    let row = '';
    for (let x = 0; x < N; x++) row += y === 0 || y === N - 1 || x === 0 || x === N - 1 ? 'X' : '.';
    rows.push(row);
  }
  return {
    id: 'new01',
    name: 'Untitled',
    theme: 'stone',
    type: 'normal',
    start: [2, 2],
    tiles: rows,
    objects: [],
  };
}

let level = emptyLevel();
let brush: Brush = TERRAIN[1];
let monsterKind = 'grunt';
let monsterLevel = 1;
let upgradeKind: string = UPGRADES[0];
let painting = false;

const canvas = document.getElementById('grid') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
canvas.width = N * CELL;
canvas.height = N * CELL;

/* ------------------------------------------------------------------ editing */

function setTile(x: number, y: number, glyph: string): void {
  if (x < 0 || y < 0 || x >= N || y >= N) return;
  const row = level.tiles[y];
  level.tiles[y] = row.slice(0, x) + glyph + row.slice(x + 1);
}

function objectsAt(x: number, y: number): LevelObject[] {
  return level.objects.filter((o) => o.x === x && o.y === y);
}

function apply(x: number, y: number): void {
  if (x < 0 || y < 0 || x >= N || y >= N) return;

  if (brush.glyph !== undefined) {
    setTile(x, y, brush.glyph);
    // An exit tile needs its object too, or the campaign cannot name a skip target.
    if (brush.glyph === 'E' && !objectsAt(x, y).some((o) => o.t === 'exit')) {
      level.objects.push({ t: 'exit', x, y, skipTo: null });
    }
    if (brush.glyph === '@' && !objectsAt(x, y).some((o) => o.t === 'tele')) {
      level.objects.push({ t: 'tele', x, y });
    }
    if (brush.glyph === '^' && !objectsAt(x, y).some((o) => o.t === 'trap')) {
      level.objects.push({ t: 'trap', x, y, opens: [] });
    }
    return;
  }

  const kind = brush.obj!;
  if (kind === 'erase') {
    level.objects = level.objects.filter((o) => !(o.x === x && o.y === y));
    return;
  }
  if (kind === 'start') {
    level.start = [x, y];
    return;
  }

  level.objects = level.objects.filter((o) => !(o.x === x && o.y === y));
  const o: LevelObject = { t: kind, x, y };
  if (kind === 'gen' || kind === 'mon') {
    o.kind = monsterKind;
    o.lvl = monsterLevel;
  }
  if (kind === 'upgrade') o.kind = upgradeKind;
  level.objects.push(o);
}

/* ------------------------------------------------------------------ analysis */

interface Report {
  ok: boolean;
  lines: { text: string; cls: string }[];
  reachable: ReadonlySet<string>;
}

/**
 * Live validation, run after every single edit.
 *
 * The whole reason the editor exists is feedback latency, so the verdict is never more
 * than one paint stroke stale. Both checks are the real ones the game and CI use —
 * validateLevel for shape, analyseLevel for playability — so the editor cannot bless a
 * level the build would reject.
 */
function analyse(): Report {
  const lines: { text: string; cls: string }[] = [];
  const fail = (t: string) => lines.push({ text: '✕ ' + t, cls: 'bad' });
  const warn = (t: string) => lines.push({ text: '! ' + t, cls: 'warn' });

  const shape = validateLevel(JSON.parse(JSON.stringify(level)));
  if (!shape.ok) {
    for (const e of shape.errors.slice(0, 6)) fail(e);
    return { ok: false, lines, reachable: new Set<string>() };
  }

  const r = analyseLevel(shape.data);
  for (const e of r.errors.slice(0, 8)) fail(e);
  if (r.errors.length > 8) fail(`…and ${r.errors.length - 8} more`);
  for (const w of r.warnings.slice(0, 4)) warn(w);

  if (r.ok && !r.warnings.length) lines.push({ text: '✓ playable', cls: 'ok' });

  const count = (t: string) => level.objects.filter((o) => o.t === t).length;
  lines.push({ text: `${r.reachable.size} reachable cells`, cls: '' });
  lines.push({ text: `${count('gen')} generators · pressure ${r.pressure}`, cls: '' });
  lines.push({ text: `${count('food')} food · ${count('treasure')} treasure · ${count('key')} keys`, cls: '' });

  return { ok: r.ok, lines, reachable: r.reachable };
}

/* ------------------------------------------------------------------ drawing */

let showReach = true;

function draw(): void {
  const report = analyse();
  ctx.fillStyle = '#06070b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const glyph = level.tiles[y][x];
      const b = TERRAIN.find((t) => t.glyph === glyph);
      ctx.fillStyle = b?.colour ?? '#ff00ff';
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);

      // Unreachable floor is the single most useful thing to see while editing.
      if (showReach && glyph !== 'X' && glyph !== ' ' && !report.reachable.has(`${x},${y}`)) {
        ctx.fillStyle = 'rgba(255,60,60,.34)';
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
  }

  ctx.strokeStyle = 'rgba(255,255,255,.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= N; i++) {
    ctx.beginPath();
    ctx.moveTo(i * CELL + 0.5, 0);
    ctx.lineTo(i * CELL + 0.5, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * CELL + 0.5);
    ctx.lineTo(canvas.width, i * CELL + 0.5);
    ctx.stroke();
  }

  // Objects carry a letter, not just a colour. Half a dozen warm-toned pickups are not
  // reliably distinguishable at 22px, and misreading food for a generator is exactly the
  // kind of mistake that survives all the way to a playtest.
  ctx.font = '700 11px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const o of level.objects) {
    if (o.t === 'exit' || o.t === 'tele' || o.t === 'trap') continue;
    const b = OBJECTS.find((x) => x.obj === o.t);
    const cx = o.x * CELL + CELL / 2;
    const cy = o.y * CELL + CELL / 2;
    ctx.fillStyle = b?.colour ?? '#fff';
    ctx.beginPath();
    ctx.arc(cx, cy, CELL * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#06070b';
    ctx.fillText(GLYPH_FOR[o.t] ?? '?', cx, cy + 0.5);
    // Generator and monster level rides in the corner — it changes what the level is.
    if ((o.t === 'gen' || o.t === 'mon') && (o.lvl ?? 1) > 1) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 9px ui-monospace, Menlo, monospace';
      ctx.fillText(String(o.lvl), cx + CELL * 0.34, cy - CELL * 0.3);
      ctx.font = '700 11px ui-monospace, Menlo, monospace';
    }
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // start marker
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.strokeRect(level.start[0] * CELL + 2, level.start[1] * CELL + 2, CELL - 4, CELL - 4);

  renderStatus(report);
}

/* ------------------------------------------------------------------ chrome */

const left = document.getElementById('left')!;
const right = document.getElementById('right')!;
const hint = document.getElementById('hint')!;
hint.textContent = 'drag to paint · right-click erases object · red = unreachable';

function brushButton(b: Brush): HTMLButtonElement {
  const el = document.createElement('button');
  el.className = 'tool' + (b === brush ? ' on' : '');
  el.innerHTML = `<span class="sw" style="background:${b.colour}"></span><span>${b.label}</span>`;
  el.onclick = () => {
    brush = b;
    buildChrome();
    draw();
  };
  return el;
}

function buildChrome(): void {
  left.innerHTML = '';
  const h = (t: string) => {
    const el = document.createElement('h2');
    el.textContent = t;
    left.appendChild(el);
  };
  h('Terrain');
  for (const b of TERRAIN) left.appendChild(brushButton(b));
  h('Objects');
  for (const b of OBJECTS) left.appendChild(brushButton(b));

  h('Placement');
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="row"><label>Kind</label><select id="mk">${MONSTER_KINDS.map(
      (k) => `<option ${k === monsterKind ? 'selected' : ''}>${k}</option>`,
    ).join('')}</select></div>
    <div class="row"><label>Level</label><select id="ml">${[1, 2, 3]
      .map((n) => `<option ${n === monsterLevel ? 'selected' : ''}>${n}</option>`)
      .join('')}</select></div>
    <div class="row"><label>Upgrade</label><select id="uk">${UPGRADES.map(
      (k) => `<option ${k === upgradeKind ? 'selected' : ''}>${k}</option>`,
    ).join('')}</select></div>`;
  left.appendChild(wrap);
  (wrap.querySelector('#mk') as HTMLSelectElement).onchange = (e) => {
    monsterKind = (e.target as HTMLSelectElement).value;
  };
  (wrap.querySelector('#ml') as HTMLSelectElement).onchange = (e) => {
    monsterLevel = Number((e.target as HTMLSelectElement).value);
  };
  (wrap.querySelector('#uk') as HTMLSelectElement).onchange = (e) => {
    upgradeKind = (e.target as HTMLSelectElement).value;
  };
}

function renderStatus(report: Report): void {
  right.innerHTML = '';
  const h = (t: string) => {
    const el = document.createElement('h2');
    el.textContent = t;
    right.appendChild(el);
  };

  h('Level');
  const meta = document.createElement('div');
  meta.innerHTML = `
    <div class="row"><label>Id</label><input id="lid" value="${level.id}"></div>
    <div class="row"><label>Name</label><input id="lname" value="${level.name}"></div>
    <div class="row"><label>Theme</label><select id="lth">${['stone', 'crypt', 'iron', 'ember', 'moss', 'bone']
      .map((t) => `<option ${t === level.theme ? 'selected' : ''}>${t}</option>`)
      .join('')}</select></div>
    <div class="row"><label>Type</label><select id="lty">${['normal', 'intro', 'treasure']
      .map((t) => `<option ${t === level.type ? 'selected' : ''}>${t}</option>`)
      .join('')}</select></div>`;
  right.appendChild(meta);
  (meta.querySelector('#lid') as HTMLInputElement).oninput = (e) => {
    level.id = (e.target as HTMLInputElement).value;
  };
  (meta.querySelector('#lname') as HTMLInputElement).oninput = (e) => {
    level.name = (e.target as HTMLInputElement).value;
  };
  (meta.querySelector('#lth') as HTMLSelectElement).onchange = (e) => {
    level.theme = (e.target as HTMLSelectElement).value;
  };
  (meta.querySelector('#lty') as HTMLSelectElement).onchange = (e) => {
    level.type = (e.target as HTMLSelectElement).value as LevelData['type'];
    draw();
  };

  h(report.ok ? 'Valid' : 'Problems');
  const status = document.createElement('div');
  status.id = 'status';
  status.innerHTML = report.lines
    .map((l) => `<div class="${l.cls}">${l.text}</div>`)
    .join('');
  right.appendChild(status);

  h('Load');
  const load = document.createElement('select');
  load.innerHTML =
    '<option value="">— new blank level —</option>' +
    CAMPAIGN.map((l, i) => `<option value="${i}">${l.id}  ${l.name}</option>`).join('');
  load.onchange = () => {
    level = load.value === '' ? emptyLevel() : JSON.parse(JSON.stringify(CAMPAIGN[Number(load.value)]));
    buildChrome();
    draw();
  };
  right.appendChild(load);

  h('Playtest');
  const test = document.createElement('button');
  test.className = 'act primary';
  test.textContent = report.ok ? 'Playtest in the real game' : 'Playtest anyway';
  test.title = 'Opens the game in a new tab running only this level';
  test.onclick = () => {
    localStorage.setItem(PLAYTEST_KEY, JSON.stringify(level));
    window.open('./index.html?playtest=1', 'bracer-playtest');
  };
  right.appendChild(test);

  h('Export');
  const ta = document.createElement('textarea');
  ta.readOnly = true;
  ta.value = JSON.stringify(level, null, 2);
  right.appendChild(ta);

  const copy = document.createElement('button');
  copy.className = 'act';
  copy.textContent = 'Copy JSON';
  copy.onclick = () => {
    void navigator.clipboard.writeText(ta.value);
    copy.textContent = 'Copied';
    setTimeout(() => (copy.textContent = 'Copy JSON'), 1200);
  };
  right.appendChild(copy);

  const dl = document.createElement('button');
  dl.className = 'act';
  dl.textContent = `Download ${level.id}.json`;
  dl.onclick = () => {
    const blob = new Blob([ta.value + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${level.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  right.appendChild(dl);

  const toggle = document.createElement('button');
  toggle.className = 'act';
  toggle.textContent = showReach ? 'Hide reachability' : 'Show reachability';
  toggle.onclick = () => {
    showReach = !showReach;
    draw();
  };
  right.appendChild(toggle);
}

/* ------------------------------------------------------------------ input */

function cellFromEvent(e: MouseEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [
    Math.floor(((e.clientX - r.left) / r.width) * N),
    Math.floor(((e.clientY - r.top) / r.height) * N),
  ];
}

canvas.addEventListener('mousedown', (e) => {
  e.preventDefault();
  painting = true;
  const [x, y] = cellFromEvent(e);
  if (e.button === 2) level.objects = level.objects.filter((o) => !(o.x === x && o.y === y));
  else apply(x, y);
  draw();
});
canvas.addEventListener('mousemove', (e) => {
  if (!painting) return;
  const [x, y] = cellFromEvent(e);
  apply(x, y);
  draw();
});
window.addEventListener('mouseup', () => (painting = false));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  const all = [...TERRAIN, ...OBJECTS];
  const n = Number(e.key);
  if (n >= 1 && n <= 9 && all[n - 1]) {
    brush = all[n - 1];
    buildChrome();
    draw();
  }
  if (e.key === 'r') {
    showReach = !showReach;
    draw();
  }
});

buildChrome();
draw();
