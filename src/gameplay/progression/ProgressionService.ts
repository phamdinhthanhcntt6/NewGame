import type { EventBus } from '../../core/EventBus';
import type { GameEvents } from '../../core/events';
import type { SeedTable } from '../farm/plotModel';
import type { GameState } from '../state/GameState';

export interface ProgressionConfig {
  levels: { base: number };
  recipeUnlockLevel: Record<string, number>;
}

/** Cumulative EXP needed to reach `level` (level 1 = 0): base × L × (L − 1). */
export const expForLevel = (level: number, base: number): number => base * level * (level - 1);

export const levelForExp = (exp: number, base: number): number => {
  let level = 1;
  while (exp >= expForLevel(level + 1, base)) level++;
  return level;
};

/**
 * Player level derived from EXP (EXP is only granted through the
 * TransactionService). Levels unlock recipes and seeds. Emits a level-up
 * event once per level gained.
 */
export class ProgressionService {
  private lastLevel: number;

  constructor(
    private readonly state: GameState,
    readonly config: ProgressionConfig,
    private readonly seeds: SeedTable,
    bus: EventBus<GameEvents>,
  ) {
    this.lastLevel = this.level;
    bus.on('economy:transaction', () => {
      const now = this.level;
      if (now > this.lastLevel) {
        const from = this.lastLevel;
        this.lastLevel = now;
        bus.emit('progression:levelUp', { from, to: now });
      }
    });
  }

  get exp(): number {
    return this.state.progression.exp;
  }

  get level(): number {
    return levelForExp(this.exp, this.config.levels.base);
  }

  /** EXP at which the current level started. */
  get levelStartExp(): number {
    return expForLevel(this.level, this.config.levels.base);
  }

  /** EXP at which the next level starts. */
  get nextLevelExp(): number {
    return expForLevel(this.level + 1, this.config.levels.base);
  }

  isRecipeUnlocked(recipeId: string): boolean {
    return this.level >= (this.config.recipeUnlockLevel[recipeId] ?? 1);
  }

  isSeedUnlocked(seedId: string): boolean {
    return this.level >= (this.seeds[seedId]?.unlockLevel ?? 1);
  }
}
