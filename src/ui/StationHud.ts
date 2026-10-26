import Phaser from 'phaser';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { t } from '../core/i18n';
import type { SimulationSnapshot } from '../gameplay/GameSimulation';
import type { Quote } from '../gameplay/market/MarketService';
import type { ProcessingConfig } from '../gameplay/processing/ProcessingService';
import type { ItemTable } from '../systems/economy/TransactionService';
import { FARM_HUD_HEIGHT, PANEL_W } from './FarmHud';
import { Button } from './widgets/Button';

type Result = { ok: true } | { ok: false; reason: string };

/** The only commands the station panel may issue. */
export interface StationUiCommands {
  selectRecipe(equipmentType: string, recipeId: string | null): Result;
  upgradeEquipment(id: string): Result;
  sell(itemId: string, qty: number): { ok: true; coins: number } | { ok: false; reason: string };
  quote(itemId: string, qty: number): Quote;
  isSellable(itemId: string): boolean;
  isEquipment(objectId: string): boolean;
}

const HEIGHT = 352;
const TEXT = { fontFamily: 'monospace', fontSize: '13px', color: '#f6e8cc' };
const MAX_ROWS = 7;

interface SellRow {
  label: Phaser.GameObjects.Text;
  b1: Button;
  b10: Button;
  all: Button;
}

/**
 * Context panel under the farm HUD:
 * - at the market: sellable items with live quotes, sell buttons, recent sales;
 * - with equipment selected: status, recipe choice, upgrade;
 * - otherwise: the shared inventory.
 */
export class StationHud {
  readonly buttons = new Map<string, Button>();
  private readonly root: Phaser.GameObjects.Container;
  private readonly title: Phaser.GameObjects.Text;
  private readonly body: Phaser.GameObjects.Text;
  private readonly message: Phaser.GameObjects.Text;
  private readonly sellRows = new Map<string, SellRow>();
  private readonly recipeButtons = new Map<string, { type: string; button: Button }>();
  private readonly upgrade: Button;
  private selectedEquipment: string | null = null;
  private readonly offs: Array<() => void> = [];

  constructor(
    private readonly scene: Phaser.Scene,
    bus: EventBus<GameEvents>,
    private readonly commands: StationUiCommands,
    private readonly items: ItemTable,
    processing: ProcessingConfig,
  ) {
    this.root = scene.add.container(0, 8 + FARM_HUD_HEIGHT + 6).setDepth(1000);
    this.root.add(scene.add.rectangle(0, 0, PANEL_W, HEIGHT, 0x1d1612, 0.88).setOrigin(0, 0).setInteractive());
    this.title = this.addText(10, 8, '', { ...TEXT, fontSize: '15px', color: '#f2c14e' });
    this.body = this.addText(10, 32, '', TEXT);
    this.message = this.addText(10, HEIGHT - 24, '', { ...TEXT, color: '#9fe08a' });

    // Sell rows are created per sellable item and positioned on update.
    for (const itemId of Object.keys(items)) {
      if (!commands.isSellable(itemId)) continue;
      const label = this.addText(10, 0, '', { ...TEXT, fontSize: '12px' });
      const sell = (qty: number | 'all') => () => {
        const owned = this.lastInventory[itemId]?.qty ?? 0;
        const n = qty === 'all' ? owned : qty;
        const r = commands.sell(itemId, n);
        this.report(r, r.ok ? t('hud.sold', { n, item: items[itemId]!.label, coins: r.coins }) : undefined);
      };
      this.sellRows.set(itemId, {
        label,
        b1: this.button(0, 0, t('hud.sell1'), sell(1), `sell.1.${itemId}`),
        b10: this.button(0, 0, t('hud.sell10'), sell(10), `sell.10.${itemId}`),
        all: this.button(0, 0, t('hud.sellAll'), sell('all'), `sell.all.${itemId}`),
      });
    }

    // Recipe choice buttons, one grid per equipment type (only the selected machine's set is shown).
    const byType = new Map<string, string[]>();
    for (const [rid, r] of Object.entries(processing.recipes)) byType.set(r.equipment, [...(byType.get(r.equipment) ?? []), rid]);
    for (const rids of byType.values()) {
      rids.forEach((rid, i) => {
        const r = processing.recipes[rid]!;
        const b = this.button(10 + (i % 3) * 104, 120 + Math.floor(i / 3) * 28, r.label, () => {
          this.report(commands.selectRecipe(r.equipment, rid), t('hud.recipeSelected', { recipe: r.label }));
        }, `recipe.${rid}`);
        this.recipeButtons.set(rid, { type: r.equipment, button: b });
      });
    }
    this.upgrade = this.button(10, 190, '', () => this.selectedEquipment && this.report(commands.upgradeEquipment(this.selectedEquipment), t('hud.equipmentUpgraded')), 'equip.upgrade');

    this.offs.push(
      bus.on('world:objectSelected', (e) => {
        this.selectedEquipment = commands.isEquipment(e.objectId) ? e.objectId : null;
      }),
    );
    this.layout();
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
  }

  private lastInventory: SimulationSnapshot['economy']['inventory'] = {};

  private addText(x: number, y: number, s: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
    const o = this.scene.add.text(x, y, s, style);
    this.root.add(o);
    return o;
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

  private report(r: Result | { ok: true; coins: number }, okText?: string): void {
    this.message.setColor(r.ok ? '#9fe08a' : '#ff8a80');
    this.message.setText(r.ok ? okText ?? '' : t(`feedback.fail.${(r as { reason: string }).reason}`));
  }

  update(s: SimulationSnapshot): void {
    this.lastInventory = s.economy.inventory;
    const atMarket = s.shop === 'market';
    const eq = !atMarket && this.selectedEquipment ? s.processing.equipment.find((e) => e.id === this.selectedEquipment) : undefined;

    for (const r of this.sellRows.values()) for (const o of [r.label, r.b1.text, r.b10.text, r.all.text]) o.setVisible(false);
    for (const { button } of this.recipeButtons.values()) button.setVisible(false);
    this.upgrade.setVisible(false);

    if (atMarket) this.showMarket(s);
    else if (eq) this.showEquipment(s, eq);
    else this.showInventory(s);
  }

  private showMarket(s: SimulationSnapshot): void {
    set(this.title, t('hud.marketTitle'));
    let y = 34;
    let shown = 0;
    for (const [itemId, row] of this.sellRows) {
      const owned = s.economy.inventory[itemId]?.qty ?? 0;
      if (owned <= 0 || shown >= MAX_ROWS) continue;
      const q = this.commands.quote(itemId, 1);
      const unit = q.ok ? q.unitNow.toFixed(1) : '-';
      set(row.label.setVisible(true).setPosition(10, y), `${this.items[itemId]!.label} x${owned} · ${unit}/1`);
      row.b1.setVisible(true).text.setPosition(10, y + 15);
      row.b10.setVisible(true).setEnabled(owned >= 10).text.setPosition(70, y + 15);
      row.all.setVisible(true).text.setPosition(140, y + 15);
      y += 40;
      shown++;
    }
    const sales = s.market.recentSales.slice(0, 3).map((h) => `${h.reason.replace('sell:', '')} ${h.items[0]?.qty ?? ''} → +${h.coins}`);
    set(this.body.setPosition(10, Math.max(y, 34)), shown === 0 ? t('hud.nothingToSell') : sales.length ? `${t('hud.recentSales')}\n${sales.join('\n')}` : '');
  }

  private showEquipment(s: SimulationSnapshot, eq: SimulationSnapshot['processing']['equipment'][number]): void {
    set(this.title, `${eq.label} · Lv${eq.level}`);
    const job = eq.job;
    const status =
      eq.status === 'idle'
        ? t('hud.equipIdle', { next: eq.nextRecipe ?? t('hud.noInputs') })
        : eq.status === 'working'
          ? t('hud.equipWorking', { pct: Math.floor(eq.progress * 100), out: `${job!.outputQty} ${this.items[job!.outputItem]!.label}` })
          : t('hud.equipDone', { out: `${job!.outputQty} ${this.items[job!.outputItem]!.label}`, q: job!.outputQuality });
    set(this.body.setPosition(10, 34), `${status}\n${t('hud.chooseRecipe')}`);
    const selected = s.processing.selectedRecipe[eq.type] ?? null;
    for (const [rid, { type, button }] of this.recipeButtons) {
      if (type !== eq.type) continue;
      button.setVisible(true).setSelected(selected === rid);
    }
    if (eq.nextUpgradeCost !== null) {
      this.upgrade
        .setVisible(true)
        .setLabel(t('hud.upgradeEquipment', { price: eq.nextUpgradeCost }))
        .setEnabled(eq.status === 'idle' && s.economy.coins >= eq.nextUpgradeCost);
    }
  }

  private showInventory(s: SimulationSnapshot): void {
    set(this.title, t('hud.inventory'));
    const inv = Object.entries(s.economy.inventory)
      .map(([id, st]) => `${this.items[id]?.label ?? id}: ${st.qty}  (Q${Math.round(st.quality)})`)
      .join('\n');
    set(this.body.setPosition(10, 34), inv || t('hud.empty'));
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.root.destroy();
  }
}

const set = (o: Phaser.GameObjects.Text, s: string) => {
  if (o.text !== s) o.setText(s);
};
