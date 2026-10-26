/**
 * Minimal typed event bus. Gameplay systems publish facts here; rendering,
 * UI, quests and tests subscribe. No Phaser dependency.
 */
export type Listener<T> = (payload: T) => void;

export class EventBus<TEvents extends { [K in keyof TEvents]: unknown }> {
  private listeners = new Map<keyof TEvents, Set<Listener<never>>>();

  on<K extends keyof TEvents>(type: K, listener: Listener<TEvents[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(type, listener);
  }

  once<K extends keyof TEvents>(type: K, listener: Listener<TEvents[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends keyof TEvents>(type: K, listener: Listener<TEvents[K]>): void {
    this.listeners.get(type)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof TEvents>(type: K, payload: TEvents[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    // Copy so listeners may unsubscribe while being notified.
    for (const listener of [...set]) (listener as Listener<TEvents[K]>)(payload);
  }

  clear(): void {
    this.listeners.clear();
  }
}
