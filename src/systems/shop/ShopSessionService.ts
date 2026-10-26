import type { EventBus } from '../../core/EventBus';
import type { GameEvents } from '../../core/events';
import type { WorldModel } from '../../gameplay/world/WorldModel';
import type { ActionRegistry } from '../../gameplay/actions/ActionRegistry';
import { distanceToFootprint, type TilePos } from '../../utils/tile';

/**
 * A "shop session" is open while the player stands at a stall they used
 * (seed stall, market). Commands that need the stall (buy seeds, sell)
 * check isOpen(); walking away closes the session.
 */
export class ShopSessionService {
  private session: { shopId: string; objectId: string } | null = null;

  constructor(
    private readonly world: WorldModel,
    private readonly bus: EventBus<GameEvents>,
    private readonly leaveDistance: number,
  ) {}

  get current(): string | null {
    return this.session?.shopId ?? null;
  }

  isOpen(shopId: string): boolean {
    return this.session?.shopId === shopId;
  }

  open(shopId: string, objectId: string): void {
    if (this.session && this.session.shopId !== shopId) this.close();
    this.session = { shopId, objectId };
    this.bus.emit('shop:opened', { shopId, objectId });
  }

  close(): void {
    if (!this.session) return;
    const { shopId } = this.session;
    this.session = null;
    this.bus.emit('shop:closed', { shopId });
  }

  checkDistance(playerTile: TilePos): void {
    if (!this.session) return;
    const o = this.world.getObject(this.session.objectId);
    if (!o || distanceToFootprint(playerTile, o.footprint) > this.leaveDistance) this.close();
  }
}

export function registerShopHandlers(registry: ActionRegistry, shops: ShopSessionService): void {
  registry.register('shop.open', {
    canStart: () => ({ ok: true }),
    complete: ({ object, action }) => shops.open(String(action.params.shopId ?? 'seeds'), object.id),
  });
}
