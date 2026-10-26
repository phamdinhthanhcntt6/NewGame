import { t } from '../../core/i18n';
import type { EquipmentView } from '../../gameplay/processing/ProcessingService';
import type { ObjectVisual, WorldRenderer } from '../render/WorldRenderer';

/** Maps processing equipment state to a renderer-agnostic visual. */
export function equipmentVisual(e: EquipmentView): ObjectVisual {
  const lv = e.level > 1 ? ` Lv${e.level}` : '';
  switch (e.status) {
    case 'idle':
      return { variant: 'idle', caption: e.label + lv };
    case 'working':
      return { variant: 'working', caption: `${e.label} ${Math.floor(e.progress * 100)}%`, progress: e.progress };
    case 'done':
      return { variant: 'done', caption: t('equip.done', { label: e.label }) };
  }
}

export class EquipmentPresenter {
  constructor(private readonly renderer: Pick<WorldRenderer, 'setObjectVisual'>) {}

  sync(equipment: readonly EquipmentView[]): void {
    for (const e of equipment) this.renderer.setObjectVisual(e.id, equipmentVisual(e));
  }
}
