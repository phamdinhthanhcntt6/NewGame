import Phaser from 'phaser';
import { CONTENT } from '../data/content';
import { t } from '../core/i18n';
import type { GameSession } from '../core/session';
import { DebugPanel } from '../ui/DebugPanel';
import { FarmHud } from '../ui/FarmHud';
import { StationHud, type StationUiCommands } from '../ui/StationHud';
import { CafeHud } from '../ui/CafeHud';
import type { Button } from '../ui/widgets/Button';

/** UI overlay with its own un-zoomed camera, running on top of a world scene. */
export class HudScene extends Phaser.Scene {
  private panel!: DebugPanel;
  farmHud: FarmHud | null = null;
  stationHud: StationHud | null = null;
  cafeHud: CafeHud | null = null;
  private session!: GameSession;

  constructor() {
    super('HudScene');
  }

  init(data: { session: GameSession }): void {
    this.session = data.session;
  }

  /** Any named HUD button (test bridge lookup). */
  button(name: string): Button | undefined {
    return this.farmHud?.buttons.get(name) ?? this.stationHud?.buttons.get(name);
  }

  create(): void {
    // Phaser reuses the scene instance on restart: never keep panels from a previous map.
    this.farmHud = this.stationHud = this.cafeHud = null;
    const sim = this.session.sim;
    this.panel = new DebugPanel(this, sim.bus);
    if (sim.cafe) this.cafeHud = new CafeHud(this, CONTENT.recipes, CONTENT.items);
    else if (sim.farm.allPlotViews().length > 0) {
      this.farmHud = new FarmHud(this, sim.bus, sim.farm, CONTENT.seeds);
      const station: StationUiCommands = {
        selectRecipe: (type, rid) => sim.processing.selectRecipe(type, rid),
        upgradeEquipment: (id) => sim.processing.upgrade(id),
        sell: (item, qty) => sim.market.sell(item, qty),
        quote: (item, qty) => sim.market.quote(item, qty),
        isSellable: (item) => sim.market.isSellable(item),
        isEquipment: (id) => sim.processing.isEquipment(id),
      };
      this.stationHud = new StationHud(this, sim.bus, station, CONTENT.items, CONTENT.processing);
    }

    const problem = this.session.loadProblem;
    if (problem) {
      const msg = problem.status === 'unsupported' ? t('save.unsupported') : t('save.problem', { status: problem.status });
      const banner = this.add
        .text(this.scale.width / 2, this.scale.height - 40, msg, { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', backgroundColor: '#c8463d', padding: { x: 8, y: 4 } })
        .setOrigin(0.5);
      this.time.delayedCall(8000, () => banner.destroy());
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.panel.destroy();
      this.farmHud?.destroy();
      this.stationHud?.destroy();
      this.cafeHud?.destroy();
      this.farmHud = this.stationHud = this.cafeHud = null;
    });
  }

  override update(): void {
    const s = this.session.sim.snapshot();
    this.panel.update(s, this.game.loop.actualFps);
    this.farmHud?.update(s);
    this.stationHud?.update(s);
    this.cafeHud?.update(s);
  }
}
