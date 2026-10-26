import Phaser from 'phaser';
import { actorDepth, floorDepth, footprintDepth, worldToScreen, type ScreenPos } from '../../utils/iso';
import type { Footprint, TilePos, WorldPos } from '../../utils/tile';
import { DEFAULT_STYLE, FEEDBACK_COLORS, PLACEHOLDER_STYLES, PLAYER_COLOR, TERRAIN_COLORS } from './placeholderStyles';
import type { ActorView, ActorViewState, FeedbackKind, FloorTileView, ObjectViewData, WorldRenderer } from './WorldRenderer';

const shade = (c: number, f: number): number => {
  const r = Math.min(255, Math.round(((c >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((c & 0xff) * f));
  return (r << 16) | (g << 8) | b;
};

const v = (p: ScreenPos, dy = 0) => new Phaser.Math.Vector2(p.x, p.y - dy);

/** Draws an extruded isometric box over a footprint. Light from upper-left (ART_BIBLE §4). */
function drawBox(g: Phaser.GameObjects.Graphics, f: Footprint, color: number, height: number): void {
  const top = worldToScreen({ x: f.x, y: f.y });
  const right = worldToScreen({ x: f.x + f.w, y: f.y });
  const bottom = worldToScreen({ x: f.x + f.w, y: f.y + f.h });
  const left = worldToScreen({ x: f.x, y: f.y + f.h });
  if (height > 0) {
    g.fillStyle(shade(color, 0.8), 1);
    g.fillPoints([v(left), v(bottom), v(bottom, height), v(left, height)], true);
    g.fillStyle(shade(color, 0.62), 1);
    g.fillPoints([v(bottom), v(right), v(right, height), v(bottom, height)], true);
  }
  g.fillStyle(color, 1);
  g.fillPoints([v(top, height), v(right, height), v(bottom, height), v(left, height)], true);
  g.lineStyle(1, shade(color, 0.45), 0.8);
  g.strokePoints([v(top, height), v(right, height), v(bottom, height), v(left, height)], true);
}

class PlaceholderActorView implements ActorView {
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly body: Phaser.GameObjects.Arc;
  private readonly nose: Phaser.GameObjects.Arc;
  private readonly held: Phaser.GameObjects.Rectangle;
  private readonly heldLabel: Phaser.GameObjects.Text;
  private readonly label: Phaser.GameObjects.Text;
  private readonly barBg: Phaser.GameObjects.Rectangle;
  private readonly barFill: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, color: number) {
    this.shadow = scene.add.ellipse(0, 0, 44, 20, 0x000000, 0.25);
    this.body = scene.add.circle(0, 0, 18, color).setStrokeStyle(2, shade(color, 0.5));
    this.nose = scene.add.circle(0, 0, 5, 0xffffff);
    this.held = scene.add.rectangle(0, 0, 22, 18, 0xfff3d6).setStrokeStyle(2, 0x6b4226);
    this.heldLabel = scene.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '11px', color: '#3b2416' }).setOrigin(0.5, 1);
    this.label = scene.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff', backgroundColor: '#00000088' }).setOrigin(0.5, 0);
    this.barBg = scene.add.rectangle(0, 0, 50, 7, 0x1b1b1b).setOrigin(0, 0.5);
    this.barFill = scene.add.rectangle(0, 0, 48, 5, 0x6db55a).setOrigin(0, 0.5);
  }

  update(s: ActorViewState): void {
    const p = worldToScreen(s.pos);
    const d = actorDepth(s.pos);
    this.shadow.setPosition(p.x, p.y).setDepth(d);
    this.body.setPosition(p.x, p.y - 22).setDepth(d + 0.01);
    // Facing marker: project a short grid-space vector to screen.
    const dir: Record<string, [number, number]> = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };
    const [fx, fy] = dir[s.facing]!;
    const len = Math.hypot(fx, fy);
    const tip = worldToScreen({ x: s.pos.x + (fx / len) * 0.18, y: s.pos.y + (fy / len) * 0.18 });
    this.nose.setPosition(tip.x, tip.y - 22).setDepth(d + 0.02);
    this.held.setVisible(s.heldItem !== null).setPosition(p.x, p.y - 52).setDepth(d + 0.03);
    this.heldLabel.setVisible(s.heldItem !== null).setText(s.heldItem ?? '').setPosition(p.x, p.y - 62).setDepth(d + 0.03);
    this.label.setText(s.state).setPosition(p.x, p.y + 8).setDepth(d + 0.03);
    const showBar = s.progress !== null;
    this.barBg.setVisible(showBar).setPosition(p.x - 25, p.y - 74).setDepth(d + 0.04);
    this.barFill.setVisible(showBar).setPosition(p.x - 24, p.y - 74).setDepth(d + 0.05);
    if (showBar) this.barFill.width = 48 * (s.progress ?? 0);
  }

  destroy(): void {
    for (const o of [this.shadow, this.body, this.nose, this.held, this.heldLabel, this.label, this.barBg, this.barFill]) o.destroy();
  }
}

/** Geometric placeholder implementation of WorldRenderer (M1–M12 gameplay phase). */
export class PlaceholderRenderer implements WorldRenderer {
  private readonly objectGfx = new Map<
    string,
    { box: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text; data: ObjectViewData; outline: Phaser.Geom.Polygon; depth: number }
  >();
  private readonly highlight: Phaser.GameObjects.Graphics;
  private readonly path: Phaser.GameObjects.Graphics;
  private readonly hover: Phaser.GameObjects.Graphics;
  private bounds = { w: 1, h: 1 };

  constructor(private readonly scene: Phaser.Scene) {
    this.path = scene.add.graphics().setDepth(floorDepth + 2);
    this.hover = scene.add.graphics().setDepth(floorDepth + 1);
    this.highlight = scene.add.graphics().setDepth(1e6);
  }

  buildWorld(floor: FloorTileView[], objects: ObjectViewData[]): void {
    const ground = this.scene.add.graphics().setDepth(floorDepth);
    const maxX = Math.max(...floor.map((t) => t.tile.x));
    const maxY = Math.max(...floor.map((t) => t.tile.y));
    for (const t of floor) {
      const style = TERRAIN_COLORS[t.kind] ?? TERRAIN_COLORS.floor!;
      const f = { x: t.tile.x, y: t.tile.y, w: 1, h: 1 };
      if (style.height > 0) {
        // Cutaway: walls on the camera-facing (south/east) edges stay low so they never hide actors.
        const front = t.tile.x === maxX || t.tile.y === maxY;
        drawBox(this.scene.add.graphics().setDepth(footprintDepth(f)), f, style.top, front ? 8 : style.height);
      } else {
        const checker = (t.tile.x + t.tile.y) % 2 === 0 ? 1 : 0.94;
        drawBox(ground, f, shade(style.top, checker), 0);
      }
    }
    for (const o of objects) this.addObject(o);
  }

  addObject(o: ObjectViewData): void {
    const style = PLACEHOLDER_STYLES[o.type] ?? DEFAULT_STYLE;
    const depth = footprintDepth(o.footprint);
    const box = this.scene.add.graphics().setDepth(depth);
    drawBox(box, o.footprint, style.color, style.height);
    const c = worldToScreen({ x: o.footprint.x + o.footprint.w / 2, y: o.footprint.y + o.footprint.h / 2 });
    const label = this.scene.add
      .text(c.x, c.y - style.height - 4, o.label, { fontFamily: 'monospace', fontSize: '11px', color: o.interactive ? '#1d1612' : '#ffffffaa', backgroundColor: o.interactive ? '#fff3d6cc' : undefined })
      .setOrigin(0.5, 1)
      .setDepth(depth + 0.05);
    // Silhouette of the extruded box: top face corners raised by height, plus the floor corners in front.
    const f = o.footprint;
    const h = style.height;
    const top = worldToScreen({ x: f.x, y: f.y });
    const right = worldToScreen({ x: f.x + f.w, y: f.y });
    const bottom = worldToScreen({ x: f.x + f.w, y: f.y + f.h });
    const left = worldToScreen({ x: f.x, y: f.y + f.h });
    const outline = new Phaser.Geom.Polygon([v(top, h), v(right, h), v(right), v(bottom), v(left), v(left, h)]);
    this.objectGfx.set(o.id, { box, label, data: o, outline, depth });
  }

  objectAtPoint(px: number, py: number): string | null {
    let best: { id: string; depth: number } | null = null;
    for (const [id, g] of this.objectGfx) {
      const hit = Phaser.Geom.Polygon.Contains(g.outline, px, py) || g.label.getBounds().contains(px, py);
      if (hit && (!best || g.depth > best.depth)) best = { id, depth: g.depth };
    }
    return best?.id ?? null;
  }

  objectClickPoint(id: string): { x: number; y: number } | null {
    const g = this.objectGfx.get(id);
    if (!g) return null;
    const b = g.label.getBounds();
    return { x: b.centerX, y: b.centerY };
  }

  removeObject(id: string): void {
    const g = this.objectGfx.get(id);
    if (!g) return;
    g.box.destroy();
    g.label.destroy();
    this.objectGfx.delete(id);
  }

  setObjectHighlight(id: string, on: boolean): void {
    this.highlight.clear();
    const g = this.objectGfx.get(id);
    if (!on || !g) return;
    const style = PLACEHOLDER_STYLES[g.data.type] ?? DEFAULT_STYLE;
    const f = g.data.footprint;
    const pts = [worldToScreen({ x: f.x, y: f.y }), worldToScreen({ x: f.x + f.w, y: f.y }), worldToScreen({ x: f.x + f.w, y: f.y + f.h }), worldToScreen({ x: f.x, y: f.y + f.h })];
    this.highlight.lineStyle(3, 0xffe066, 1);
    this.highlight.strokePoints(pts.map((p) => v(p, style.height)), true);
    this.highlight.strokePoints(pts.map((p) => v(p)), true);
  }

  createActor(_id: string, kind: 'player' | 'customer' | 'employee'): ActorView {
    return new PlaceholderActorView(this.scene, kind === 'player' ? PLAYER_COLOR : 0xd07a3a);
  }

  setPathPreview(points: WorldPos[] | null): void {
    this.path.clear();
    if (!points || points.length < 2) return;
    this.path.lineStyle(3, 0x2f7fd8, 0.6);
    this.path.strokePoints(points.map((p) => v(worldToScreen(p))), false);
    const end = worldToScreen(points[points.length - 1]!);
    this.path.fillStyle(0x2f7fd8, 0.8).fillCircle(end.x, end.y, 6);
  }

  setHoverTile(tile: TilePos | null): void {
    this.hover.clear();
    if (!tile) return;
    const f = { x: tile.x, y: tile.y, w: 1, h: 1 };
    const pts = [worldToScreen({ x: f.x, y: f.y }), worldToScreen({ x: f.x + 1, y: f.y }), worldToScreen({ x: f.x + 1, y: f.y + 1 }), worldToScreen({ x: f.x, y: f.y + 1 })];
    this.hover.lineStyle(2, 0xffffff, 0.9).strokePoints(pts.map((p) => v(p)), true);
  }

  showFeedback(at: WorldPos, text: string, kind: FeedbackKind): void {
    const p = worldToScreen(at);
    const t = this.scene.add
      .text(p.x, p.y - 40, text, { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', backgroundColor: FEEDBACK_COLORS[kind], padding: { x: 4, y: 2 } })
      .setOrigin(0.5, 1)
      .setDepth(1e6 + 1);
    this.scene.tweens.add({ targets: t, y: t.y - 24, alpha: 0, delay: 600, duration: 500, onComplete: () => t.destroy() });
  }

  frame(widthTiles: number, heightTiles: number): void {
    this.bounds = { w: widthTiles, h: heightTiles };
    const cam = this.scene.cameras.main;
    const c = worldToScreen({ x: widthTiles / 2, y: heightTiles / 2 });
    const pxW = (widthTiles + heightTiles) * 64;
    const pxH = (widthTiles + heightTiles) * 32 + 80;
    cam.setZoom(Math.min(cam.width / pxW, cam.height / pxH) * 0.92);
    cam.centerOn(c.x, c.y - 20);
  }

  reframe(): void {
    this.frame(this.bounds.w, this.bounds.h);
  }
}
