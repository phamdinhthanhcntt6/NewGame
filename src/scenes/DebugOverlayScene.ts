import Phaser from 'phaser';
import type { GameSimulation } from '../gameplay/GameSimulation';
import { DebugPanel } from '../ui/DebugPanel';

/** UI overlay with its own un-zoomed camera, running on top of a world scene. */
export class DebugOverlayScene extends Phaser.Scene {
  private panel!: DebugPanel;
  private sim!: GameSimulation;

  constructor() {
    super('DebugOverlayScene');
  }

  init(data: { sim: GameSimulation }): void {
    this.sim = data.sim;
  }

  create(): void {
    this.panel = new DebugPanel(this, this.sim.bus);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.panel.destroy());
  }

  override update(): void {
    this.panel.update(this.sim.snapshot(), this.game.loop.actualFps);
  }
}
