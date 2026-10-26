import type { EventBus } from '../../core/EventBus';
import type { GameEvents } from '../../core/events';
import { t } from '../../core/i18n';
import type { DecorView } from '../../gameplay/decor/FurnitureService';
import type { WorldModel } from '../../gameplay/world/WorldModel';
import { tileCenter } from '../../utils/tile';
import type { ObjectViewData, WorldRenderer } from '../render/WorldRenderer';

export const objectViewData = (world: WorldModel, id: string): ObjectViewData | null => {
  const o = world.getObject(id);
  return o ? { id: o.id, type: o.type, label: o.def.label, footprint: o.footprint, rotation: o.rotation, interactive: !!o.def.interaction } : null;
};

/**
 * Decorate mode visuals: keeps drawn objects in step with furniture changes,
 * shows the placement grid and the green/red ghost, and reports rejected
 * placements where they happened.
 */
export class DecorPresenter {
  private readonly offs: Array<() => void> = [];
  private areaShown = false;

  constructor(
    bus: EventBus<GameEvents>,
    world: WorldModel,
    private readonly renderer: Pick<WorldRenderer, 'addObject' | 'removeObject' | 'setDecorArea' | 'setPlacementPreview' | 'showFeedback'>,
    private readonly labelOf: (type: string) => string,
    onObjectGone: (id: string) => void,
  ) {
    this.offs.push(
      bus.on('decor:changed', ({ objectId }) => {
        renderer.removeObject(objectId);
        const data = objectViewData(world, objectId);
        if (data) renderer.addObject(data);
        onObjectGone(objectId);
      }),
      bus.on('decor:rejected', ({ reason, tile }) => {
        if (tile) renderer.showFeedback(tileCenter(tile), t(`decor.fail.${reason}`), 'error');
      }),
    );
  }

  sync(decor: DecorView | null): void {
    const active = decor?.active ?? false;
    if (active !== this.areaShown) {
      this.renderer.setDecorArea(active ? decor!.area : null);
      this.areaShown = active;
    }
    const p = decor?.preview;
    const s = decor?.selection;
    this.renderer.setPlacementPreview(
      p && s ? { footprint: p.footprint, valid: p.valid, label: p.valid ? this.labelOf(s.type) : t(`decor.fail.${p.reason}`) } : null,
    );
  }

  destroy(): void {
    for (const off of this.offs) off();
  }
}
