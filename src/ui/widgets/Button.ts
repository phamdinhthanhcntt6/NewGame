import type Phaser from 'phaser';

const STYLE = {
  fontFamily: 'monospace',
  fontSize: '13px',
  color: '#1d1612',
  backgroundColor: '#e8c48a',
  padding: { x: 6, y: 3 },
};

/** Placeholder button: a labelled text box. Disabled buttons ignore clicks. */
export class Button {
  readonly text: Phaser.GameObjects.Text;
  private enabled = true;
  private selected = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    label: string,
    private readonly onClick: () => void,
    readonly name: string,
  ) {
    this.text = scene.add.text(x, y, label, STYLE).setInteractive({ useHandCursor: true });
    this.text.on('pointerdown', () => {
      if (this.enabled && this.text.visible) this.onClick();
    });
    this.text.on('pointerover', () => this.enabled && this.text.setAlpha(0.85));
    this.text.on('pointerout', () => this.text.setAlpha(1));
  }

  setLabel(label: string): this {
    if (this.text.text !== label) this.text.setText(label);
    return this;
  }

  setEnabled(on: boolean): this {
    if (on === this.enabled) return this;
    this.enabled = on;
    this.restyle();
    return this;
  }

  setSelected(on: boolean): this {
    if (on === this.selected) return this;
    this.selected = on;
    this.restyle();
    return this;
  }

  setVisible(on: boolean): this {
    this.text.setVisible(on);
    return this;
  }

  get isEnabled(): boolean {
    return this.enabled && this.text.visible;
  }

  private restyle(): void {
    this.text.setBackgroundColor(!this.enabled ? '#8a8072' : this.selected ? '#f2c14e' : '#e8c48a');
    this.text.setColor(this.enabled ? '#1d1612' : '#4a4038');
  }
}
