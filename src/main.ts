import Phaser from 'phaser';
import { DebugOverlayScene } from './scenes/DebugOverlayScene';
import { SandboxScene } from './scenes/SandboxScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1d1612',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  input: { activePointers: 2 },
  scene: [SandboxScene, DebugOverlayScene],
});

if (import.meta.env.DEV) (window as unknown as { __PHASER_GAME__: Phaser.Game }).__PHASER_GAME__ = game;
