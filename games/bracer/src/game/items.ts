import { T } from '@/data/tuning';
import type { UpgradeId } from '@/data/classes';

export type ItemKind = 'food' | 'key' | 'potion' | 'treasure' | 'upgrade';

export interface Item {
  kind: ItemKind;
  x: number;
  y: number;
  half: number;
  alive: boolean;
  /** Yellow jugs and blue potions can be destroyed by shots; most food cannot. */
  breakable: boolean;
  /** Which permanent upgrade this grants, for kind === 'upgrade'. */
  upgrade?: UpgradeId;
}

export function makeItem(
  kind: ItemKind,
  x: number,
  y: number,
  opts: { breakable?: boolean; upgrade?: UpgradeId } = {},
): Item {
  const item: Item = {
    kind,
    x,
    y,
    half: T.ITEM_HALF,
    alive: true,
    // Potions default to breakable (blue); an author marks orange ones indestructible.
    breakable: opts.breakable ?? kind === 'potion',
  };
  if (opts.upgrade) item.upgrade = opts.upgrade;
  return item;
}

/** Do keys and potions share the same 12 slots? Yes — and that is the whole tension. */
export function usesInventorySlot(kind: ItemKind): boolean {
  return kind === 'key' || kind === 'potion';
}

export type PickupOutcome =
  | { kind: 'none' }
  | { kind: 'blocked' } // inventory full: the item becomes solid to the player
  | { kind: 'food'; health: number; score: number }
  | { kind: 'key'; score: number }
  | { kind: 'potion'; score: number }
  | { kind: 'treasure'; score: number }
  | { kind: 'upgrade'; upgrade: UpgradeId }
  | { kind: 'upgradeDuplicate' }; // degrades to a plain potion

export interface InventoryView {
  keys: number;
  potions: number;
  full: boolean;
  hasUpgrade(u: UpgradeId): boolean;
}

/**
 * Resolve what happens when the player touches an item.
 *
 * The inventory rule is the interesting one: keys and potions share twelve slots, and
 * when they are full you cannot pick either up — *and you cannot walk through them
 * either*. Hoarding keys physically barricades you out of corridors, which is exactly
 * why the strategy guides say to carry two to four and no more.
 */
export function resolvePickup(item: Item, inv: InventoryView): PickupOutcome {
  switch (item.kind) {
    case 'food':
      return { kind: 'food', health: T.FOOD_HEALTH, score: T.SCORE.food };
    case 'treasure':
      return { kind: 'treasure', score: T.SCORE.treasure };
    case 'key':
      return inv.full ? { kind: 'blocked' } : { kind: 'key', score: T.SCORE.key };
    case 'potion':
      return inv.full ? { kind: 'blocked' } : { kind: 'potion', score: 0 };
    case 'upgrade': {
      const u = item.upgrade;
      if (!u) return { kind: 'none' };
      // Taking an upgrade you already have is not greed rewarded: it degrades to an
      // ordinary potion, and is wasted entirely if you have no room for that.
      if (inv.hasUpgrade(u)) {
        return inv.full ? { kind: 'blocked' } : { kind: 'upgradeDuplicate' };
      }
      return { kind: 'upgrade', upgrade: u };
    }
  }
}
