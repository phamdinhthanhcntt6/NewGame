import { describe, expect, it } from 'vitest';
import { actorDepth, footprintDepth, screenToWorld, worldToScreen } from '../../src/utils/iso';
import { tileCenter, worldToTile } from '../../src/utils/tile';

describe('isometric projection', () => {
  it('maps tile corners to the 2:1 diamond', () => {
    expect(worldToScreen({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(worldToScreen({ x: 1, y: 0 })).toEqual({ x: 64, y: 32 });
    expect(worldToScreen({ x: 0, y: 1 })).toEqual({ x: -64, y: 32 });
    expect(worldToScreen({ x: 1, y: 1 })).toEqual({ x: 0, y: 64 });
  });

  it('round-trips every tile centre of a 64×64 grid', () => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const c = tileCenter({ x, y });
        const back = screenToWorld(worldToScreen(c));
        expect(back.x).toBeCloseTo(c.x, 9);
        expect(back.y).toBeCloseTo(c.y, 9);
        expect(worldToTile(back)).toEqual({ x, y });
      }
    }
  });
});

describe('depth sorting', () => {
  const at = (x: number, y: number) => actorDepth(tileCenter({ x, y }));

  it('1×1 object: actor behind on N/W/NW, in front on S/E/SE', () => {
    const d = footprintDepth({ x: 5, y: 5, w: 1, h: 1 });
    expect(at(5, 4)).toBeLessThan(d); // N
    expect(at(4, 5)).toBeLessThan(d); // W
    expect(at(4, 4)).toBeLessThan(d); // NW
    expect(at(5, 6)).toBeGreaterThan(d); // S
    expect(at(6, 5)).toBeGreaterThan(d); // E
    expect(at(6, 6)).toBeGreaterThan(d); // SE
  });

  it('2×1 table: actor in front along the whole south edge, behind along the north edge', () => {
    const f = { x: 3, y: 7, w: 2, h: 1 };
    const d = footprintDepth(f);
    expect(at(3, 8)).toBeGreaterThan(d);
    expect(at(4, 8)).toBeGreaterThan(d);
    expect(at(5, 7)).toBeGreaterThan(d); // east end
    expect(at(3, 6)).toBeLessThan(d);
    expect(at(4, 6)).toBeLessThan(d);
    expect(at(2, 7)).toBeLessThan(d); // west end
  });
});
