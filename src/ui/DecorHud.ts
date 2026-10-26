import Phaser from 'phaser';
import { t } from '../core/i18n';
import type { DecorResult, FurnitureConfig } from '../gameplay/decor/FurnitureService';
import type { SimulationSnapshot } from '../gameplay/GameSimulation';
import type { ItemTable } from '../systems/economy/TransactionService';
import { PANEL_W } from './FarmHud';
import { Button } from './widgets/Button';

/** The only commands the decorate panel may issue. */
export interface DecorUiCommands {
  enter(): DecorResult;
  exit(): void;
  buy(type: string): DecorResult;
  select(type: string): DecorResult;
  rotate(): DecorResult;
  storeSelected(): DecorResult;
  clearSelection(): void;
}

const TEXT = { fontFamily: 'monospace', fontSize: '13px', color: '#f6e8cc' };
const ROW_H = 26;

/**
 * Placeholder decorate panel (S12 shop + S13 decorate). A "Trang trí" button
 * opens it; while open it takes the café panel's slot. It lists the catalog
 * with buy / place buttons, the current selection with rotate / store /
 * deselect, and the furniture bonuses. Placement itself happens by clicking
 * the world; this panel only issues DecorUiCommands.
 */
export class DecorHud {
  readonly buttons = new Map<string, Button>();
  private readonly root: Phaser.GameObjects.Container;
  private readonly open: Button;
  private readonly stats: Phaser.GameObjects.Text;
  private readonly rows = new Map<string, { label: Phaser.GameObjects.Text; buy: Button; place: Button }>();
  private readonly selection: Phaser.GameObjects.Text;
  private readonly preview: Phaser.GameObjects.Text;
  private readonly message: Phaser.GameObjects.Text;
  private readonly rotate: Button;
  private readonly store: Button;
  private readonly deselect: Button;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly commands: DecorUiCommands,
    private readonly furniture: FurnitureConfig,
    private readonly items: ItemTable,
  ) {
    this.open = new Button(scene, 8, 0, t('decor.open'), () => this.report(commands.enter()), 'decor.enter');
    this.open.text.setDepth(1000);
    this.buttons.set('decor.enter', this.open);

    // Above the café panel, which it covers while decorating; the background swallows clicks.
    this.root = scene.add.container(0, 8).setDepth(1100).setVisible(false);
    this.root.add(scene.add.rectangle(0, 0, PANEL_W, 704, 0x1d1612, 0.97).setOrigin(0, 0).setInteractive());
    const add = (y: number, s: string, style: Phaser.Types.GameObjects.Text.TextStyle = TEXT) => {
      const o = scene.add.text(10, y, s, style);
      this.root.add(o);
      return o;
    };
    const head = { ...TEXT, color: '#f2c14e' };
    add(8, t('decor.title'), { ...head, fontSize: '15px' });
    add(28, t('decor.help'), { ...TEXT, fontSize: '11px', color: '#b8a890', wordWrap: { width: PANEL_W - 20 } });
    this.stats = add(80, '', { ...TEXT, fontSize: '12px' });
    add(150, t('decor.shop'), head);
    Object.keys(furniture.catalog).forEach((type, i) => {
      const y = 170 + i * ROW_H;
      const label = add(y + 3, '', { ...TEXT, fontSize: '12px' });
      const buy = this.button(196, y, t('decor.buy'), () => this.report(commands.buy(type)), `decor.buy.${type}`);
      const place = this.button(244, y, '', () => this.report(commands.select(type)), `decor.place.${type}`);
      this.rows.set(type, { label, buy, place });
    });
    const y0 = 170 + Object.keys(furniture.catalog).length * ROW_H + 10;
    add(y0, t('decor.selected'), head);
    this.selection = add(y0 + 18, '', { ...TEXT, fontSize: '12px' });
    this.rotate = this.button(10, y0 + 40, t('decor.rotate'), () => this.report(commands.rotate()), 'decor.rotate');
    this.store = this.button(106, y0 + 40, t('decor.store'), () => this.report(commands.storeSelected()), 'decor.store');
    this.deselect = this.button(220, y0 + 40, t('decor.deselect'), () => commands.clearSelection(), 'decor.deselect');
    this.preview = add(y0 + 70, '', { ...TEXT, fontSize: '12px', wordWrap: { width: PANEL_W - 20 } });
    this.message = add(y0 + 92, '', { ...TEXT, fontSize: '12px', wordWrap: { width: PANEL_W - 20 } });
    this.button(10, y0 + 120, t('decor.done'), () => commands.exit(), 'decor.exit');

    this.layout();
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
  }

  get isOpen(): boolean {
    return this.root.visible;
  }

  private button(x: number, y: number, label: string, onClick: () => void, name: string): Button {
    const b = new Button(this.scene, x, y, label, onClick, name);
    this.root.add(b.text);
    this.buttons.set(name, b);
    return b;
  }

  private layout(): void {
    this.root.x = this.scene.scale.width - PANEL_W - 8;
    this.open.text.setPosition(8, this.scene.scale.height - 36);
  }

  private report(r: DecorResult): void {
    this.message.setColor(r.ok ? '#9fe08a' : '#ff8a80');
    this.message.setText(r.ok ? '' : t(`decor.fail.${r.reason}`));
  }

  update(s: SimulationSnapshot): void {
    const d = s.decor;
    const active = d?.active ?? false;
    this.open.setVisible(!!d && !active);
    if (active !== this.root.visible) {
      this.root.setVisible(active);
      if (!active) this.message.setText('');
    }
    if (!d || !active) return;

    const b = d.bonuses;
    const pct = (f: number) => Math.round((f - 1) * 100);
    set(
      this.stats,
      [
        t('hud.coins', { n: s.economy.coins }) + '   ' + t('decor.level', { n: s.progression.level }),
        t('decor.scores', { comfort: b.comfort, decor: b.decor, spots: b.spots }),
        t('decor.effects', { patience: pct(b.patienceFactor), traffic: pct(b.trafficFactor) }),
      ].join('\n'),
    );

    for (const [type, row] of this.rows) {
      const f = this.furniture.catalog[type]!;
      const name = this.items[f.itemId]?.label ?? type;
      const locked = s.progression.level < f.unlockLevel;
      const bonus = [f.comfort ? `+${f.comfort}♥` : '', f.decor ? `+${f.decor}✿` : ''].filter(Boolean).join(' ');
      set(row.label, `${name} ${locked ? t('decor.locked', { n: f.unlockLevel }) : `${f.price}đ`} ${bonus}`);
      row.buy.setEnabled(!locked && s.economy.coins >= f.price);
      const owned = d.owned[type] ?? 0;
      row.place.setLabel(t('decor.place', { n: owned })).setEnabled(owned > 0).setSelected(d.selection?.kind === 'place' && d.selection.type === type);
    }

    const sel = d.selection;
    const label = (type: string) => this.items[this.furniture.catalog[type]?.itemId ?? '']?.label ?? type;
    set(this.selection, !sel ? t('decor.none') : t(sel.kind === 'place' ? 'decor.placing' : 'decor.moving', { item: label(sel.type), dir: sel.rotation + 1 }));
    this.rotate.setVisible(!!sel);
    this.deselect.setVisible(!!sel);
    this.store.setVisible(sel?.kind === 'move');
    const p = d.preview;
    this.preview.setColor(p?.valid ? '#9fe08a' : '#ff8a80');
    set(this.preview, !sel ? '' : !p ? t('decor.pointAt') : p.valid ? t('decor.ok') : t(`decor.fail.${p.reason}`));
  }

  destroy(): void {
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.open.text.destroy();
    this.root.destroy();
  }
}

const set = (o: Phaser.GameObjects.Text, s: string) => {
  if (o.text !== s) o.setText(s);
};
