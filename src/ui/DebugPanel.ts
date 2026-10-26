import type Phaser from 'phaser';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { SimulationSnapshot } from '../gameplay/GameSimulation';
import { t } from '../core/i18n';

/** Functional debug overlay (placeholder UI). Reads snapshots, never writes gameplay state. */
export class DebugPanel {
  private readonly text: Phaser.GameObjects.Text;
  private readonly recent: string[] = [];
  private readonly offs: Array<() => void> = [];

  constructor(scene: Phaser.Scene, bus: EventBus<GameEvents>) {
    this.text = scene.add
      .text(8, 8, '', { fontFamily: 'monospace', fontSize: '12px', color: '#f6e8cc', backgroundColor: '#000000aa', padding: { x: 6, y: 4 } })
      .setScrollFactor(0)
      .setDepth(2e6);
    const log = (s: string) => {
      this.recent.unshift(s);
      this.recent.length = Math.min(this.recent.length, 6);
    };
    this.offs.push(
      bus.on('actor:stateChanged', (e) => log(`${e.actorId}: ${e.from} → ${e.to}`)),
      bus.on('interaction:started', (e) => log(`start ${e.objectId}.${e.actionId}`)),
      bus.on('interaction:completed', (e) => log(`done  ${e.objectId}.${e.actionId}`)),
      bus.on('interaction:failed', (e) => log(`FAIL  ${e.objectId} ${e.reason}${e.detail ? `/${e.detail}` : ''}`)),
      bus.on('interaction:cancelled', (e) => log(`cancel ${e.objectId} (${e.reason})`)),
      bus.on('move:unreachable', (e) => log(`unreachable ${e.target.x},${e.target.y}`)),
    );
  }

  update(s: SimulationSnapshot, fps: number): void {
    const p = s.player;
    const cur = s.interaction.current;
    this.text.setText(
      [
        `TheCoffeeSixSense · map: ${s.map} · ${fps.toFixed(0)} fps`,
        t('debug.help'),
        `player  ${p.state}  tile ${p.tile.x},${p.tile.y}  pos ${p.pos.x.toFixed(2)},${p.pos.y.toFixed(2)}  facing ${p.facing}`,
        `held    ${p.heldItem ?? '-'}`,
        `action  ${cur ? `${cur.objectId}.${cur.actionId ?? '?'} [${cur.phase}] ${(cur.progress * 100).toFixed(0)}%` : '-'}`,
        `queue   ${s.interaction.queue.map((q) => q.objectId).join(' → ') || '-'}`,
        '— events —',
        ...this.recent,
      ].join('\n'),
    );
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.text.destroy();
  }
}
