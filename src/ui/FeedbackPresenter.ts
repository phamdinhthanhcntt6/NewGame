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

  constructor(bus: EventBus<GameEvents>, world: WorldModel, sink: FeedbackSink, playerPos: () => WorldPos, customerPos: (id: string) => WorldPos | undefined = () => undefined) {
    const objectPos = (id: string): WorldPos => {
      const o = world.getObject(id);
      return o ? { x: o.footprint.x + o.footprint.w / 2, y: o.footprint.y + o.footprint.h / 2 } : playerPos();
    };
    this.offs.push(
      bus.on('interaction:failed', (e) => sink.showFeedback(objectPos(e.objectId), t(`feedback.fail.${e.detail ?? e.reason}`), 'error')),
      bus.on('interaction:completed', (e) => sink.showFeedback(objectPos(e.objectId), t('feedback.done', { action: t(`action.${e.actionId}`) }), 'ok')),
      bus.on('interaction:queued', (e) => sink.showFeedback(objectPos(e.objectId), t('feedback.queued', { n: e.queueLength }), 'info')),
      bus.on('move:unreachable', (e) => sink.showFeedback(tileCenter(e.target), t('feedback.fail.unreachable'), 'error')),
      bus.on('customer:left', (e) => {
        const at = customerPos(e.customerId);
        if (at && e.reason !== 'served') sink.showFeedback(at, t(`cafe.reason.${e.reason}`), 'error');
      }),
      bus.on('cafe:rated', (e) => {
        const at = customerPos(e.customerId);
        if (!at) return;
        const stars = '★'.repeat(e.stars) + '☆'.repeat(5 - e.stars);
        const words = e.feedback.map((k) => t(`rating.${k}`)).join(', ');
        sink.showFeedback(at, `${stars} ${words} +${e.coins + e.tip}`, e.stars >= 4 ? 'ok' : e.stars >= 3 ? 'info' : 'error');
      }),
      bus.on('progression:levelUp', (e) => sink.showFeedback(playerPos(), t('progression.levelUp', { level: e.to }), 'ok')),
      bus.on('order:changed', (e) => {
        const at = customerPos(e.customerId);
        if (at && e.to === 'ACCEPTED') sink.showFeedback(at, t('cafe.accepted'), 'ok');
      }),
    );
  }

  destroy(): void {
    for (const off of this.offs) off();
  }
}
