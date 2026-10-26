import Phaser from 'phaser';
import { HudScene } from './scenes/HudScene';
import { WorldScene, type WorldSceneData } from './scenes/WorldScene';

// ?map=sandbox opens the M1 movement sandbox (never saved). Default: the farm.
const params = new URLSearchParams(window.location.search);
const mapId = params.get('map') ?? 'farm';
const start: WorldSceneData = { mapId, persistent: mapId !== 'sandbox', fresh: params.has('fresh') };

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1d1612',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  input: { activePointers: 2 },
  scene: [],
});
game.scene.add('WorldScene', WorldScene, true, start);
game.scene.add('HudScene', HudScene, false);

if (import.meta.env.DEV) (window as unknown as { __PHASER_GAME__: Phaser.Game }).__PHASER_GAME__ = game;
