import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { WorldModel } from '../gameplay/world/WorldModel';
import type { FeedbackKind } from '../components/render/WorldRenderer';
import { t } from '../core/i18n';
import { tileCenter, type WorldPos } from '../utils/tile';

export interface FeedbackSink {
  showFeedback(at: WorldPos, text: string, kind: FeedbackKind): void;
}

/**
 * Turns gameplay events into player-facing feedback. Knows nothing about how
 * feedback is drawn (FeedbackSink) — the production HUD swaps the sink only.
 */
export class FeedbackPresenter {
  private readonly offs: Array<() => void> = [];

  constructor(bus: EventBus<GameEvents>, world: WorldModel, sink: FeedbackSink, playerPos: () => WorldPos) {
    const objectPos = (id: string): WorldPos => {
      const o = world.getObject(id);
      return o ? { x: o.footprint.x + o.footprint.w / 2, y: o.footprint.y + o.footprint.h / 2 } : playerPos();
    };
    this.offs.push(
      bus.on('interaction:failed', (e) => sink.showFeedback(objectPos(e.objectId), t(`feedback.fail.${e.detail ?? e.reason}`), 'error')),
      bus.on('interaction:completed', (e) => sink.showFeedback(objectPos(e.objectId), t('feedback.done', { action: t(`action.${e.actionId}`) }), 'ok')),
      bus.on('interaction:queued', (e) => sink.showFeedback(objectPos(e.objectId), t('feedback.queued', { n: e.queueLength }), 'info')),
      bus.on('move:unreachable', (e) => sink.showFeedback(tileCenter(e.target), t('feedback.fail.unreachable'), 'error')),
    );
  }

  destroy(): void {
    for (const off of this.offs) off();
  }
}
