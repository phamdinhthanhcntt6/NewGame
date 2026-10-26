import Phaser from 'phaser';
import { t } from '../core/i18n';
import type { BrewingConfig, BrewStep } from '../gameplay/cafe/BrewingService';
import type { RecipeTable } from '../gameplay/cafe/OrderService';
import type { SimulationSnapshot } from '../gameplay/GameSimulation';
import type { ItemTable } from '../systems/economy/TransactionService';
import { PANEL_W } from './FarmHud';
import { Button } from './widgets/Button';

type Result = { ok: true } | { ok: false; reason: string };

/** The only commands the café panel may issue. */
export interface CafeUiCommands {
  chooseBean(itemId: string): Result;
  chooseAddition(additionId: string): Result;
  press(): Result;
  cancelBrew(): Result;
  buySupply(itemId: string, qty: number): Result;
}

const TEXT = { fontFamily: 'monospace', fontSize: '13px', color: '#f6e8cc' };
const BAR_W = PANEL_W - 20;

/**
 * Placeholder café HUD: coins, open orders with patience, the brewing panel
 * (bean / addition choices and the timing needle), supplies at the shelf,
 * recent outcomes and stock. World actions (counter, stations, serving)
 * happen by clicking the world; this panel only issues CafeUiCommands.
 */
export class CafeHud {
  readonly buttons = new Map<string, Button>();
  private readonly root: Phaser.GameObjects.Container;
  private readonly stats: Phaser.GameObjects.Text;
  private readonly orders: Phaser.GameObjects.Text;
  private readonly brewInfo: Phaser.GameObjects.Text;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly recent: Phaser.GameObjects.Text;
  private readonly message: Phaser.GameObjects.Text;
  private readonly press: Button;
  private readonly cancel: Button;
  private readonly beanButtons = new Map<string, Button>();
  private readonly additionButtons = new Map<string, Button>();
  private readonly supplyButtons: Button[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly commands: CafeUiCommands,
    private readonly recipes: RecipeTable,
    private readonly items: ItemTable,
    brewing: BrewingConfig,
  ) {
    this.root = scene.add.container(0, 8).setDepth(1000);
    this.root.add(scene.add.rectangle(0, 0, PANEL_W, 704, 0x1d1612, 0.9).setOrigin(0, 0).setInteractive());
    const add = (y: number, s: string, style: Phaser.Types.GameObjects.Text.TextStyle = TEXT) => {
      const o = scene.add.text(10, y, s, style);
      this.root.add(o);
      return o;
    };
    const head = { ...TEXT, color: '#f2c14e' };
    add(8, t('cafe.title'), { ...head, fontSize: '15px' });
    add(28, t('cafe.help'), { ...TEXT, fontSize: '11px', color: '#b8a890', wordWrap: { width: PANEL_W - 20 } });
    this.stats = add(74, '');
    add(128, t('cafe.orders'), head);
    this.orders = add(146, '', { ...TEXT, fontSize: '12px' });

    add(262, t('brew.title'), head);
    this.brewInfo = add(280, '', { ...TEXT, fontSize: '12px', wordWrap: { width: PANEL_W - 20 } });
    this.bar = scene.add.graphics();
    this.root.add(this.bar);
    const beans = Object.entries(items).filter(([, d]) => d.category === 'roasted');
    beans.forEach(([id, d], i) => {
      this.beanButtons.set(id, this.button(10 + i * 106, 372, d.label.replace('Hạt rang ', ''), () => this.report(commands.chooseBean(id)), `brew.bean.${id}`));
    });
    Object.entries(brewing.additions).forEach(([id, a], i) => {
      this.additionButtons.set(id, this.button(10 + i * 106, 372, a.label, () => this.report(commands.chooseAddition(id)), `brew.add.${id}`));
    });
    this.press = this.button(10, 372, t('brew.press'), () => this.report(commands.press()), 'brew.press');
    this.cancel = this.button(220, 400, t('brew.cancel'), () => this.report(commands.cancelBrew()), 'brew.cancel');
    // Supplies (only while standing at the shelf).
    Object.entries(brewing.supplies).forEach(([id, price], i) => {
      const label = items[id]?.label ?? id;
      this.supplyButtons.push(this.button(10, 432 + i * 26, t('supply.buy', { item: label, n: 1, price }), () => this.report(commands.buySupply(id, 1)), `supply.1.${id}`));
      this.supplyButtons.push(this.button(200, 432 + i * 26, `x5 (${price * 5})`, () => this.report(commands.buySupply(id, 5)), `supply.5.${id}`));
    });
    this.message = add(492, '', { ...TEXT, color: '#9fe08a' });
    add(516, t('cafe.recent'), head);
    this.recent = add(534, '', { ...TEXT, fontSize: '12px' });

    this.layout();
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
  }

  private button(x: number, y: number, label: string, onClick: () => void, name: string): Button {
    const b = new Button(this.scene, x, y, label, onClick, name);
    this.root.add(b.text);
    this.buttons.set(name, b);
    return b;
  }

  private layout(): void {
    this.root.x = this.scene.scale.width - PANEL_W - 8;
  }

  private report(r: Result): void {
    this.message.setColor(r.ok ? '#9fe08a' : '#ff8a80');
    this.message.setText(r.ok ? '' : t(`feedback.fail.${r.reason}`));
  }

  /** Space bar = stop the needle. */
  pressShortcut(): void {
    if (this.press.isEnabled) this.report(this.commands.press());
  }

  update(s: SimulationSnapshot): void {
    const cafe = s.cafe;
    if (!cafe) return;
    set(this.stats, [t('hud.coins', { n: s.economy.coins }) + '   ' + t('hud.exp', { n: s.economy.exp }), t('cafe.queue', { n: cafe.queue.length, seats: cafe.freeSpots }), this.stockLine(s)].join('\n'));

    const lines = cafe.orders.map((o) => {
      const c = cafe.customers.find((x) => x.id === o.customerId);
      const pat = c?.patience == null ? '' : ` ${Math.round(c.patience * 100)}%`;
      return `#${o.id} ${this.recipes[o.recipeId]?.label ?? o.recipeId} · ${t(`order.${o.status}`)}${pat}`;
    });
    set(this.orders, lines.length ? lines.slice(0, 7).join('\n') : t('cafe.noOrders'));

    this.updateBrew(s);

    for (const b of this.supplyButtons) b.setVisible(s.shop === 'supplies');

    const recent = cafe.recentOrders.slice(0, 7).map((o) => {
      const last = o.history.at(-1);
      return `#${o.id} ${this.recipes[o.recipeId]?.label ?? o.recipeId} → ${t(`order.${o.status}`)}${last?.reason ? ` (${t(`cafe.reason.${last.reason}`)})` : ''}`;
    });
    set(this.recent, recent.join('\n') || '-');
  }

  private stockLine(s: SimulationSnapshot): string {
    const n = (cat: string) => Object.entries(s.economy.inventory).filter(([id]) => this.items[id]?.category === cat).reduce((a, [, st]) => a + st.qty, 0);
    return t('cafe.stockLine', { beans: n('roasted'), milk: s.economy.inventory.milk?.qty ?? 0, condensed: s.economy.inventory.condensed_milk?.qty ?? 0 });
  }

  private updateBrew(s: SimulationSnapshot): void {
    const cafe = s.cafe!;
    const brew = cafe.brew;
    for (const b of [...this.beanButtons.values(), ...this.additionButtons.values(), this.press, this.cancel]) b.setVisible(false);
    this.bar.clear();

    if (cafe.heldDrink) {
      const d = cafe.heldDrink;
      set(this.brewInfo, t('brew.holding', { drink: this.recipes[d.recipeId]?.label ?? d.recipeId, q: d.quality, order: d.orderId }));
      return;
    }
    if (!brew) {
      const next = cafe.orders.find((o) => o.id === cafe.nextToBrew);
      set(this.brewInfo, next ? t('brew.next', { order: next.id, drink: this.recipes[next.recipeId]?.label ?? next.recipeId }) : t('brew.idle'));
      return;
    }
    const step = brew.current;
    const progress = brew.steps.map((st, i) => (i < brew.stepIndex ? '✓' : i === brew.stepIndex ? '▶' : '·') + t(`brew.step.${st.id}`)).join(' ');
    const where = step ? t(`brew.station.${step.station}`) : '';
    const hint = !step ? '' : !brew.armed ? t('brew.goTo', { station: where }) : t(`brew.do.${step.kind}`);
    set(this.brewInfo, `#${brew.orderId} ${this.recipes[brew.recipeId]?.label ?? brew.recipeId}\n${progress}\n${hint}`);
    this.cancel.setVisible(true);
    if (!step || !brew.armed) return;

    if (step.kind === 'choose_bean') {
      const owned = s.economy.inventory;
      for (const [id, b] of this.beanButtons) b.setVisible(true).setEnabled((owned[id]?.qty ?? 0) > 0);
    } else if (step.kind === 'choose_addition') {
      for (const b of this.additionButtons.values()) b.setVisible(true).setEnabled(true);
    } else {
      this.drawNeedle(step, brew.needle ?? 0);
      this.press.setVisible(true).setEnabled(true);
    }
  }

  private drawNeedle(step: Extract<BrewStep, { kind: 'timing' }>, needle: number): void {
    const y = 344;
    this.bar.fillStyle(0x3a2a20, 1).fillRect(10, y, BAR_W, 16);
    const lo = Math.max(0, step.target - step.tolerance);
    const hi = Math.min(1, step.target + step.tolerance);
    this.bar.fillStyle(0x6db55a, 1).fillRect(10 + lo * BAR_W, y, (hi - lo) * BAR_W, 16);
    this.bar.fillStyle(0xffffff, 1).fillRect(10 + needle * BAR_W - 2, y - 4, 4, 24);
  }

  destroy(): void {
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.root.destroy();
  }
}

const set = (o: Phaser.GameObjects.Text, s: string) => {
  if (o.text !== s) o.setText(s);
};
