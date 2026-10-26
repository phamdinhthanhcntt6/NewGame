import Phaser from 'phaser';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { t } from '../core/i18n';
import type { FarmResult } from '../gameplay/farm/FarmService';
import type { SeedTable } from '../gameplay/farm/plotModel';
import type { SimulationSnapshot } from '../gameplay/GameSimulation';
import { Button } from './widgets/Button';

/** The only commands the farm UI may issue. Implemented by FarmService. */
export interface FarmUiCommands {
  selectSeed(seedId: string | null): FarmResult;
  buySeeds(seedId: string, qty: number): FarmResult;
  buyPlot(id: string): FarmResult;
  upgradeSoil(id: string): FarmResult;
  nextSoilCost(id: string): number | null;
}

export const PANEL_W = 330;
/** Height of the farm panel; the station panel stacks below it. */
export const FARM_HUD_HEIGHT = 354;
const TEXT = { fontFamily: 'monospace', fontSize: '13px', color: '#f6e8cc' };

/**
 * Placeholder farm HUD: currency, watering can, inventory, seed selection +
 * shop, selected-plot panel (buy land / upgrade soil). Reads snapshots,
 * issues FarmUiCommands, never touches state directly.
 */
export class FarmHud {
  readonly buttons = new Map<string, Button>();
  private readonly root: Phaser.GameObjects.Container;
  private readonly stats: Phaser.GameObjects.Text;
  private readonly shopLine: Phaser.GameObjects.Text;
  private readonly plotInfo: Phaser.GameObjects.Text;
  private readonly message: Phaser.GameObjects.Text;
  private readonly seedRows: Array<{ id: string; select: Button; buy1: Button; buy5: Button }> = [];
  private readonly plotBuy: Button;
  private readonly plotUpgrade: Button;
  private selectedPlot: string | null = null;
  private readonly offs: Array<() => void> = [];

  constructor(
    private readonly scene: Phaser.Scene,
    bus: EventBus<GameEvents>,
    private readonly commands: FarmUiCommands,
    private readonly seeds: SeedTable,
  ) {
    this.root = scene.add.container(0, 8).setDepth(1000);
    // Background swallows clicks so they never fall through to the world.
    const bg = scene.add.rectangle(0, 0, PANEL_W, FARM_HUD_HEIGHT, 0x1d1612, 0.88).setOrigin(0, 0).setInteractive();
    this.root.add(bg);
    let y = 8;
    const line = (text = '', style = TEXT) => {
      const o = scene.add.text(10, y, text, style);
      this.root.add(o);
      return o;
    };
    line(t('hud.farmTitle'), { ...TEXT, fontSize: '15px', color: '#f2c14e' });
    y += 24;
    this.stats = line();
    y += 54;
    line(t('hud.seeds'), { ...TEXT, color: '#f2c14e' });
    y += 20;
    for (const [id, seed] of Object.entries(seeds)) {
      const select = this.button(10, y, seed.label, () => this.report(commands.selectSeed(id)), `seed.select.${id}`);
      const buy1 = this.button(150, y, `+1 (${seed.purchaseCost})`, () => this.report(commands.buySeeds(id, 1), t('hud.bought', { n: 1, seed: seed.label })), `seed.buy1.${id}`);
      const buy5 = this.button(240, y, '+5', () => this.report(commands.buySeeds(id, 5), t('hud.bought', { n: 5, seed: seed.label })), `seed.buy5.${id}`);
      this.seedRows.push({ id, select, buy1, buy5 });
      y += 28;
    }
    this.shopLine = line();
    y += 26;
    line(t('hud.plot'), { ...TEXT, color: '#f2c14e' });
    y += 20;
    this.plotInfo = line();
    y += 60;
    this.plotBuy = this.button(10, y, '', () => this.selectedPlot && this.report(commands.buyPlot(this.selectedPlot), t('hud.plotBought')), 'plot.buy');
    this.plotUpgrade = this.button(150, y, '', () => this.selectedPlot && this.report(commands.upgradeSoil(this.selectedPlot), t('hud.soilUpgraded')), 'plot.upgrade');
    y += 32;
    this.message = line('', { ...TEXT, color: '#9fe08a' });

    this.offs.push(
      bus.on('world:objectSelected', (e) => {
        if (e.objectId.startsWith('plot_')) this.selectedPlot = e.objectId;
      }),
    );
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

  private report(r: FarmResult, okText?: string): void {
    this.message.setColor(r.ok ? '#9fe08a' : '#ff8a80');
    this.message.setText(r.ok ? okText ?? '' : t(`feedback.fail.${r.reason}`));
  }

  update(s: SimulationSnapshot): void {
    const eco = s.economy;
    const farm = s.farm;
    set(this.stats, [
      t('hud.coins', { n: eco.coins }) + '   ' + t('hud.exp', { n: eco.exp }),
      t('hud.can', { n: farm.can.water, max: farm.can.capacity }),
      t('hud.capacity', { n: eco.itemCount, max: eco.capacity }),
    ].join('\n'));

    const shopOpen = s.shop === 'seeds';
    for (const r of this.seedRows) {
      const seed = this.seeds[r.id]!;
      const owned = eco.inventory[seed.seedItem]?.qty ?? 0;
      r.select.setLabel(`${seed.label} x${owned}`).setSelected(farm.selectedSeed === r.id);
      r.buy1.setEnabled(shopOpen && eco.coins >= seed.purchaseCost);
      r.buy5.setEnabled(shopOpen && eco.coins >= seed.purchaseCost * 5);
    }
    set(this.shopLine, shopOpen ? t('hud.shopOpen') : t('hud.shopClosed'));
    this.shopLine.setColor(shopOpen ? '#9fe08a' : '#b8a890');

    const plot = this.selectedPlot ? farm.plots.find((p) => p.id === this.selectedPlot) : undefined;
    if (!plot) {
      set(this.plotInfo, t('hud.noPlot'));
      this.plotBuy.setVisible(false);
      this.plotUpgrade.setVisible(false);
    } else {
      const seed = plot.seedId ? this.seeds[plot.seedId] : undefined;
      set(this.plotInfo, [
        `${plot.id}  ${plot.locked ? t('hud.locked') : plot.phase}  Lv${plot.soilLevel}`,
        seed ? `${seed.label}  ${Math.floor(plot.progress * 100)}%  ${t('hud.waterings', { n: plot.waterings, max: seed.waterings })}` : '',
        plot.needsWater ? t('hud.needsWater') : '',
      ].join('\n'));
      this.plotBuy.setVisible(plot.locked).setLabel(t('hud.buyPlot', { price: plot.price })).setEnabled(eco.coins >= plot.price);
      const cost = this.commands.nextSoilCost(plot.id);
      const canUpgrade = !plot.locked && cost !== null && ['EMPTY', 'PREPARED', 'HARVESTED'].includes(plot.phase);
      this.plotUpgrade.setVisible(!plot.locked && cost !== null).setLabel(t('hud.upgradeSoil', { price: cost ?? 0 })).setEnabled(canUpgrade && eco.coins >= (cost ?? 0));
    }
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
