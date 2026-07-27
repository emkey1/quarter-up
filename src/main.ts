import { Display } from '@/engine/display';
import { Input } from '@/engine/input';
import { Loop } from '@/engine/loop';
import { validateLevel } from '@/game/level';
import { PlayScreen } from '@/ui/play';
import provingJson from '@/data/levels/proving.json';

function boot(): void {
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('#stage missing');

  const result = validateLevel(provingJson);
  if (!result.ok) {
    document.body.innerHTML = `<pre style="padding:24px;color:#ff6b5e;white-space:pre-wrap">Level failed validation:\n\n${result.errors.join('\n')}</pre>`;
    return;
  }

  const display = new Display(stage);
  const input = new Input();
  input.attach();

  const screen = new PlayScreen(display, input, result.data, 'elf');
  const loop = new Loop(screen);
  screen.loop = loop;
  loop.start();

  document.getElementById('boot')?.remove();

  // Expose for console poking during development.
  Object.assign(window as unknown as Record<string, unknown>, { bracer: { display, input, screen, loop } });
}

boot();
