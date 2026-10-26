import type { CustomerView } from '../../gameplay/cafe/CafeService';
import type { RecipeTable } from '../../gameplay/cafe/OrderService';
import type { ActorView, WorldRenderer } from '../render/WorldRenderer';

const BUBBLE_STATES = new Set(['ORDERING', 'WAITING', 'RECEIVING', 'TASTING']);

/**
 * Keeps one ActorView per customer in sync with the simulation: creates views
 * for new customers, destroys views of customers who left. Shows the ordered
 * drink as a bubble and remaining patience as the bar.
 */
export class CustomerPresenter {
  private readonly views = new Map<string, ActorView>();

  constructor(
    private readonly renderer: Pick<WorldRenderer, 'createActor'>,
    private readonly recipes: RecipeTable,
  ) {}

  sync(customers: readonly CustomerView[]): void {
    const seen = new Set<string>();
    for (const c of customers) {
      seen.add(c.id);
      let v = this.views.get(c.id);
      if (!v) {
        v = this.renderer.createActor(c.id, 'customer');
        this.views.set(c.id, v);
      }
      const recipe = this.recipes[c.recipeId]?.label ?? c.recipeId;
      v.update({
        pos: c.pos,
        state: c.state,
        facing: c.facing,
        heldItem: null,
        progress: c.patience,
        bubble: BUBBLE_STATES.has(c.state) ? (c.orderStatus === 'CREATED' ? `${recipe}?` : recipe) : null,
      });
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        v.destroy();
        this.views.delete(id);
      }
    }
  }

  /** Front-most customer drawn under a render-space point. */
  customerAtPoint(px: number, py: number): string | null {
    let best: { id: string; depth: number } | null = null;
    for (const [id, v] of this.views) if (v.hitTest(px, py) && (!best || v.depth > best.depth)) best = { id, depth: v.depth };
    return best?.id ?? null;
  }

  destroy(): void {
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
  }
}
