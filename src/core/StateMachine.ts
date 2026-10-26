/**
 * Generic finite state machine with an explicit transition table.
 * Illegal transitions throw, so broken gameplay flows fail loudly in tests
 * instead of silently drifting into an impossible state.
 */
export interface TransitionRecord<S extends string> {
  from: S;
  to: S;
  at: number;
}

export class IllegalTransitionError extends Error {
  constructor(name: string, from: string, to: string) {
    super(`[${name}] illegal transition ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export class StateMachine<S extends string> {
  private current: S;
  private readonly log: TransitionRecord<S>[] = [];
  private readonly listeners = new Set<(from: S, to: S) => void>();

  constructor(
    private readonly name: string,
    initial: S,
    private readonly transitions: Readonly<Record<S, readonly S[]>>,
    private readonly now: () => number = () => Date.now(),
    private readonly maxLog = 200,
  ) {
    this.current = initial;
  }

  get state(): S {
    return this.current;
  }

  is(...states: S[]): boolean {
    return states.includes(this.current);
  }

  can(to: S): boolean {
    return this.transitions[this.current].includes(to);
  }

  transition(to: S): void {
    if (to === this.current) return;
    if (!this.can(to)) throw new IllegalTransitionError(this.name, this.current, to);
    const from = this.current;
    this.current = to;
    this.log.push({ from, to, at: this.now() });
    if (this.log.length > this.maxLog) this.log.shift();
    for (const l of this.listeners) l(from, to);
  }

  onTransition(listener: (from: S, to: S) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  history(): readonly TransitionRecord<S>[] {
    return this.log;
  }
}
