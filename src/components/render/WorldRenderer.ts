import type { ActorState, Facing } from '../../entities/Actor';
import type { Footprint, TilePos, WorldPos } from '../../utils/tile';

/**
 * Contract between the gameplay simulation and whatever draws it.
 * Placeholder shapes implement it today; production atlases will implement
 * it later. Gameplay code never imports an implementation, only this file.
 * All positions are in WORLD units (tiles); projection is the renderer's job.
 */
export interface FloorTileView {
  tile: TilePos;
  kind: string;
  walkable: boolean;
}

export interface ObjectViewData {
  id: string;
  type: string;
  label: string;
  footprint: Footprint;
  rotation: number;
  interactive: boolean;
}

export interface ActorViewState {
  pos: WorldPos;
  state: ActorState;
  facing: Facing;
  heldItem: string | null;
  /** 0–1 while WORKING, null otherwise. */
  progress: number | null;
}

export interface ActorView {
  update(s: ActorViewState): void;
  destroy(): void;
}

export type FeedbackKind = 'ok' | 'info' | 'error';

export interface WorldRenderer {
  buildWorld(floor: FloorTileView[], objects: ObjectViewData[]): void;
  addObject(o: ObjectViewData): void;
  removeObject(id: string): void;
  setObjectHighlight(id: string, highlighted: boolean): void;
  /**
   * Front-most object (interactive or not) whose *drawn* shape covers this
   * point (render-space pixels, i.e. camera world point). Players click what
   * they see — a tall object's top face lies over the tiles behind it.
   */
  objectAtPoint(px: number, py: number): string | null;
  /** Render-space point a player would naturally click on an object (its top/label). */
  objectClickPoint(id: string): { x: number; y: number } | null;
  createActor(id: string, kind: 'player' | 'customer' | 'employee'): ActorView;
  /** Debug/feedback: remaining path of the selected actor. */
  setPathPreview(points: WorldPos[] | null): void;
  setHoverTile(tile: TilePos | null): void;
  /** Short-lived world-space feedback (e.g. "Unreachable" over a tile). */
  showFeedback(at: WorldPos, text: string, kind: FeedbackKind): void;
  /** World point at the centre of the map, for camera framing. */
  frame(widthTiles: number, heightTiles: number): void;
}
