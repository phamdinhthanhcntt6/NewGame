import type { EventBus } from '../../core/EventBus';
import type { GameEvents } from '../../core/events';
import type { FeedbackEntry, GameState } from '../state/GameState';
import type { Drink } from './BrewingService';
import type { Customer, ServiceOutcome } from './CafeService';
import type { Order, RecipeTable } from './OrderService';

export interface RatingConfig {
  rating: {
    weights: { recipeAccuracy: number; beanQuality: number; brewingPerformance: number; servingTime: number };
    preferredBeanBonus: number;
    servingTime: { fullMarksUntilShare: number };
    /** Score thresholds for 1…5 stars. */
    starThresholds: number[];
    priceMultiplier: number[];
    tipShare: number[];
    expMultiplier: number[];
    feedback: { bitterOvershoot: number; sweetOvershoot: number; coldAfterMs: number; slowServiceShare: number; aromaBeanQuality: number };
  };
  reputation: { window: number; start: number; failedRating: number; trafficPerStar: number; trafficMin: number; trafficMax: number; tipBonusPerStar: number };
  feedbackHistoryLimit: number;
}

export type FeedbackKey = 'wrongOrder' | 'tooBitter' | 'tooSweet' | 'cold' | 'slowService' | 'excellentAroma' | 'delicious';

export interface Rating {
  score: number;
  stars: number;
  components: FeedbackEntry['components'];
  feedback: FeedbackKey[];
  coins: number;
  tip: number;
  exp: number;
}

export interface RatingInput {
  order: Order;
  drink: Drink;
  /** Sim times: when the order was accepted and when the drink was served. */
  acceptedAt: number;
  servedAt: number;
  /** The customer's drink patience (ms): the serving-time yardstick. */
  patienceMs: number;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/**
 * Customer evaluation. Score (0–100) = 40% recipe accuracy + 25% bean
 * quality + 20% brewing performance + 15% serving time (weights in data),
 * computed only from what actually happened. Stars, feedback, price, tip
 * and EXP follow from it, and every result feeds reputation and history.
 */
export class RatingService {
  constructor(
    private readonly state: GameState,
    readonly config: RatingConfig,
    private readonly recipes: RecipeTable,
    private readonly bus: EventBus<GameEvents>,
  ) {}

  /** Pure evaluation (no side effects). */
  evaluate(i: RatingInput): Rating {
    const r = this.config.rating;
    const recipe = this.recipes[i.order.recipeId]!;
    const recipeAccuracy = clamp(i.drink.recipeAccuracy * 100);
    const preferred = i.drink.beanItem === recipe.preferredBean;
    const beanQuality = clamp(i.drink.beanQuality + (preferred ? r.preferredBeanBonus : 0));
    const brewingPerformance = clamp(i.drink.performance * 100);
    const share = (i.servedAt - i.acceptedAt) / i.patienceMs;
    const full = r.servingTime.fullMarksUntilShare;
    const servingTime = clamp(100 * (1 - Math.max(0, share - full) / (1 - full)));
    const w = r.weights;
    const score = Math.round(w.recipeAccuracy * recipeAccuracy + w.beanQuality * beanQuality + w.brewingPerformance * brewingPerformance + w.servingTime * servingTime);
    const stars = r.starThresholds.reduce((s, th, idx) => (score >= th ? idx + 1 : s), 1);

    // Feedback: deterministic rules on the drink and the service.
    const f = r.feedback;
    const feedback: FeedbackKey[] = [];
    const wrong = i.drink.choices.filter((c) => !c.correct);
    if (wrong.length) feedback.push('wrongOrder');
    if ((i.drink.stepErrors.extract ?? 0) > f.bitterOvershoot) feedback.push('tooBitter');
    const sweetRecipe = recipe.ingredients.some((g) => g.itemId === 'condensed_milk');
    const condensedByMistake = wrong.some((c) => c.chosen === 'condensed_milk');
    if (condensedByMistake || (sweetRecipe && (i.drink.stepErrors.pour ?? 0) > f.sweetOvershoot)) feedback.push('tooSweet');
    if (i.servedAt - i.drink.readyAt > f.coldAfterMs) feedback.push('cold');
    if (share > f.slowServiceShare) feedback.push('slowService');
    if (preferred && i.drink.beanQuality >= f.aromaBeanQuality) feedback.push('excellentAroma');
    const negative = feedback.some((k) => k !== 'excellentAroma');
    if (stars >= 4 && !negative) feedback.push('delicious');

    const base = i.order.reward;
    const idx = stars - 1;
    const repBonus = 1 + (this.reputation - 3) * this.config.reputation.tipBonusPerStar;
    const coins = Math.round(base.coins * (r.priceMultiplier[idx] ?? 1));
    const tip = Math.max(0, Math.round(base.coins * (r.tipShare[idx] ?? 0) * repBonus));
    const exp = Math.max(0, Math.round(base.exp * (r.expMultiplier[idx] ?? 1)));
    return { score, stars, components: { recipeAccuracy, beanQuality, brewingPerformance, servingTime }, feedback, coins, tip, exp };
  }

  /** Rating policy for CafeService: evaluate, record history + reputation, return what the customer pays. */
  readonly policy = (order: Order, drink: Drink, customer: Customer): ServiceOutcome => {
    const acceptedAt = order.history.find((h) => h.status === 'ACCEPTED')?.at ?? order.createdAt;
    const servedAt = order.history.find((h) => h.status === 'SERVED')?.at ?? drink.readyAt;
    const rating = this.evaluate({ order, drink, acceptedAt, servedAt, patienceMs: customer.def.drinkPatienceMs });
    this.record({
      orderId: order.id,
      recipeId: order.recipeId,
      at: servedAt,
      stars: rating.stars,
      score: rating.score,
      components: rating.components,
      feedback: rating.feedback,
      coins: rating.coins,
      tip: rating.tip,
      exp: rating.exp,
    });
    this.state.cafe.stats.served++;
    this.bus.emit('cafe:rated', { orderId: order.id, customerId: customer.id, stars: rating.stars, score: rating.score, feedback: rating.feedback, coins: rating.coins, tip: rating.tip });
    return { coins: rating.coins + rating.tip, exp: rating.exp };
  };

  /** A customer who left unhappy (never served) counts as a low rating. */
  recordFailure(reason: string): void {
    this.pushRating(this.config.reputation.failedRating);
    this.state.cafe.stats.failed++;
    this.bus.emit('cafe:reputationChanged', { reputation: this.reputation, reason });
  }

  private record(e: FeedbackEntry): void {
    const hist = this.state.cafe.feedback;
    hist.push(e);
    if (hist.length > this.config.feedbackHistoryLimit) hist.splice(0, hist.length - this.config.feedbackHistoryLimit);
    this.pushRating(e.stars);
    this.bus.emit('cafe:reputationChanged', { reputation: this.reputation, reason: 'rated' });
  }

  private pushRating(stars: number): void {
    const r = this.state.cafe.ratings;
    r.push(stars);
    if (r.length > this.config.reputation.window) r.splice(0, r.length - this.config.reputation.window);
  }

  /** Average of recent ratings (1–5); the starting value until there is history. */
  get reputation(): number {
    const r = this.state.cafe.ratings;
    return r.length ? r.reduce((a, b) => a + b, 0) / r.length : this.config.reputation.start;
  }

  /** Customer traffic multiplier from reputation (higher = customers come more often). */
  get trafficFactor(): number {
    const c = this.config.reputation;
    return Math.max(c.trafficMin, Math.min(c.trafficMax, 1 + (this.reputation - 3) * c.trafficPerStar));
  }

  history(): FeedbackEntry[] {
    return [...this.state.cafe.feedback].reverse();
  }
}
