import { validateRoom, type RoomData } from '@/game/room';
import { FINAL_ROOM } from '@/game/campaign';

/**
 * The room library.
 *
 * Loaded eagerly through Vite's glob import rather than listed by hand: a hundred and
 * three imports maintained manually is a hundred and three chances to forget one, and
 * the failure mode — a room that silently does not exist until someone reaches it — is
 * the worst kind, because it only shows up an hour into a run.
 *
 * Every room is validated at load. A bundled room failing validation is a build-time
 * mistake, not a runtime condition, so it throws loudly here rather than rendering an
 * empty screen forty rooms later.
 */

const modules = import.meta.glob<{ default: unknown }>('./rooms/*.json', { eager: true });

const byId = new Map<string, RoomData>();

for (const [path, mod] of Object.entries(modules)) {
  const id = path.replace(/^.*\/(.+)\.json$/, '$1');
  const parsed = validateRoom(mod.default);
  if (!parsed.ok) {
    throw new Error(`room ${id} failed validation:\n  ${parsed.errors.join('\n  ')}`);
  }
  byId.set(id, parsed.data);
}

export const ROOM_COUNT = byId.size;

/** The campaign room for this number. Rooms are numbered from 1. */
export function roomFor(n: number): RoomData {
  const clamped = Math.max(1, Math.min(FINAL_ROOM, Math.floor(n)));
  const room = byId.get(`r${String(clamped).padStart(3, '0')}`);
  if (!room) throw new Error(`no room r${clamped}`);
  return room;
}

/** A secret room by the gate it hangs off — 20, 30 or 40. */
export function secretRoom(gate: number): RoomData | null {
  return byId.get(`s${gate}`) ?? null;
}

export function roomById(id: string): RoomData | null {
  return byId.get(id) ?? null;
}

export function allRoomIds(): string[] {
  return [...byId.keys()].sort();
}
