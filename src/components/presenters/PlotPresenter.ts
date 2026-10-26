import { t } from '../../core/i18n';
import type { PlotView } from '../../gameplay/farm/FarmService';
import type { SeedTable } from '../../gameplay/farm/plotModel';
import type { ObjectVisual, WorldRenderer } from '../render/WorldRenderer';

/** Maps a plot's gameplay state to a renderer-agnostic visual (variant + caption + progress). */
export function plotVisual(p: PlotView, seeds: SeedTable): ObjectVisual {
  const lv = p.soilLevel > 1 ? ` Lv${p.soilLevel}` : '';
  if (p.locked) return { variant: 'locked', caption: t('plot.locked', { price: p.price }) };
  const seed = p.seedId ? seeds[p.seedId]?.label ?? p.seedId : '';
  switch (p.phase) {
    case 'EMPTY':
      return { variant: 'empty', caption: t('plot.empty') + lv };
    case 'PREPARED':
      return { variant: 'prepared', caption: t('plot.prepared') + lv };
    case 'PLANTED':
    case 'GROWING':
      return p.needsWater
        ? { variant: 'thirsty', caption: t('plot.thirsty', { seed }), progress: p.progress }
        : { variant: `growing_${p.stage}`, caption: `${seed} ${Math.floor(p.progress * 100)}%`, progress: p.progress };
    case 'READY':
      return { variant: 'ready', caption: t('plot.ready', { seed }) };
    case 'HARVESTED':
      return { variant: 'harvested', caption: t('plot.harvested') + lv };
  }
}

/** Pushes plot visuals to the renderer each frame; the renderer skips unchanged ones. */
export class PlotPresenter {
  constructor(
    private readonly renderer: Pick<WorldRenderer, 'setObjectVisual'>,
    private readonly seeds: SeedTable,
  ) {}

  sync(plots: readonly PlotView[]): void {
    for (const p of plots) this.renderer.setObjectVisual(p.id, plotVisual(p, this.seeds));
  }
}
