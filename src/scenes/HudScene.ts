import Phaser from 'phaser';
import { CONTENT } from '../data/content';
import { t } from '../core/i18n';
import type { GameSession } from '../core/session';
import { DebugPanel } from '../ui/DebugPanel';
import { FarmHud } from '../ui/FarmHud';

/** UI overlay with its own un-zoomed camera, running on top of a world scene. */
export class HudScene extends Phaser.Scene {
  private panel!: DebugPanel;
  farmHud: FarmHud | null = null;
  private session!: GameSession;

  constructor() {
    super('HudScene');
  }

  init(data: { session: GameSession }): void {
    this.session = data.session;
  }

  create(): void {
    const sim = this.session.sim;
    this.panel = new DebugPanel(this, sim.bus);
    if (sim.farm.allPlotViews().length > 0) this.farmHud = new FarmHud(this, sim.bus, sim.farm, CONTENT.seeds, CONTENT.items);

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
    });
  }

  override update(): void {
    const s = this.session.sim.snapshot();
    this.panel.update(s, this.game.loop.actualFps);
    this.farmHud?.update(s);
  }
}
