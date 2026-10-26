import Phaser from 'phaser';
import { t } from '../core/i18n';
import type { RecipeTable } from '../gameplay/cafe/OrderService';
import type { SimulationSnapshot } from '../gameplay/GameSimulation';
import type { ItemTable } from '../systems/economy/TransactionService';
import { PANEL_W } from './FarmHud';

const TEXT = { fontFamily: 'monospace', fontSize: '13px', color: '#f6e8cc' };
const STATUS_COLOR: Record<string, string> = { CREATED: '#f2c14e', ACCEPTED: '#9fd3ff', PREPARING: '#9fd3ff', READY: '#9fe08a', SERVED: '#9fe08a' };

/**
 * Placeholder café HUD: coins, open orders with patience, queue and free
 * seats, recent order outcomes, café-relevant stock. Read-only: the café is
 * operated by interacting with the world (order counter, later stations).
 */
export class CafeHud {
  private readonly root: Phaser.GameObjects.Container;
  private readonly stats: Phaser.GameObjects.Text;
  private readonly orders: Phaser.GameObjects.Text;
  private readonly recent: Phaser.GameObjects.Text;
  private readonly stock: Phaser.GameObjects.Text;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly recipes: RecipeTable,
    private readonly items: ItemTable,
  ) {
    this.root = scene.add.container(0, 8).setDepth(1000);
    this.root.add(scene.add.rectangle(0, 0, PANEL_W, 700, 0x1d1612, 0.88).setOrigin(0, 0).setInteractive());
    const add = (y: number, s: string, style: Phaser.Types.GameObjects.Text.TextStyle = TEXT) => {
      const o = scene.add.text(10, y, s, style);
      this.root.add(o);
      return o;
    };
    const head = { ...TEXT, color: '#f2c14e' };
    add(8, t('cafe.title'), { ...head, fontSize: '15px' });
    add(28, t('cafe.help'), { ...TEXT, fontSize: '11px', color: '#b8a890', wordWrap: { width: PANEL_W - 20 } });
    this.stats = add(62, '');
    add(118, t('cafe.orders'), head);
    this.orders = add(138, '');
    add(330, t('cafe.recent'), head);
    this.recent = add(350, '');
    add(500, t('cafe.stock'), head);
    this.stock = add(520, '');
    this.layout();
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
  }

  private layout(): void {
    this.root.x = this.scene.scale.width - PANEL_W - 8;
  }

  update(s: SimulationSnapshot): void {
    const cafe = s.cafe;
    if (!cafe) return;
    set(this.stats, [t('hud.coins', { n: s.economy.coins }) + '   ' + t('hud.exp', { n: s.economy.exp }), t('cafe.queue', { n: cafe.queue.length, seats: cafe.freeSpots }), t('cafe.customers', { n: cafe.customers.length })].join('\n'));

    const lines = cafe.orders.map((o) => {
      const c = cafe.customers.find((x) => x.id === o.customerId);
      const pat = c?.patience == null ? '' : ` ${Math.round(c.patience * 100)}%`;
      return `#${o.id} ${this.recipes[o.recipeId]?.label ?? o.recipeId} · ${t(`order.${o.status}`)}${pat}`;
    });
    set(this.orders, lines.length ? lines.slice(0, 10).join('\n') : t('cafe.noOrders'));
    this.orders.setColor(cafe.orders.length && cafe.orders[0] ? STATUS_COLOR[cafe.orders[0].status] ?? '#f6e8cc' : '#b8a890');

    const recent = cafe.recentOrders.slice(0, 7).map((o) => {
      const last = o.history.at(-1);
      return `#${o.id} ${this.recipes[o.recipeId]?.label ?? o.recipeId} → ${t(`order.${o.status}`)}${last?.reason ? ` (${t(`cafe.reason.${last.reason}`)})` : ''}`;
    });
    set(this.recent, recent.join('\n') || '-');

    const stock = Object.entries(s.economy.inventory)
      .filter(([id]) => ['roasted', 'ingredient'].includes(this.items[id]?.category ?? ''))
      .map(([id, st]) => `${this.items[id]!.label}: ${st.qty} (Q${Math.round(st.quality)})`);
    set(this.stock, stock.join('\n') || t('cafe.noStock'));
  }

  destroy(): void {
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.root.destroy();
  }
}

const set = (o: Phaser.GameObjects.Text, s: string) => {
  if (o.text !== s) o.setText(s);
};
