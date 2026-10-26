import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import { IllegalTransitionError, StateMachine } from '../../src/core/StateMachine';
import { ACTOR_TRANSITIONS, type ActorState } from '../../src/entities/Actor';

describe('StateMachine', () => {
  it('allows table transitions, logs them, and rejects illegal ones', () => {
    let t = 0;
    const fsm = new StateMachine<ActorState>('p', 'IDLE', ACTOR_TRANSITIONS, () => t);
    t = 5;
    fsm.transition('MOVING');
    fsm.transition('INTERACTING');
    fsm.transition('WORKING');
    fsm.transition('CARRYING');
    expect(fsm.history().map((h) => h.to)).toEqual(['MOVING', 'INTERACTING', 'WORKING', 'CARRYING']);
    expect(fsm.history()[0]!.at).toBe(5);
    expect(() => fsm.transition('WORKING')).toThrow(IllegalTransitionError);
    expect(fsm.state).toBe('CARRYING');
  });

  it('treats a self-transition as a no-op', () => {
    const fsm = new StateMachine<ActorState>('p', 'IDLE', ACTOR_TRANSITIONS);
    const spy = vi.fn();
    fsm.onTransition(spy);
    fsm.transition('IDLE');
    expect(spy).not.toHaveBeenCalled();
  });

  it('cannot jump from IDLE straight to WORKING', () => {
    const fsm = new StateMachine<ActorState>('p', 'IDLE', ACTOR_TRANSITIONS);
    expect(fsm.can('WORKING')).toBe(false);
  });
});

describe('EventBus', () => {
  it('delivers typed payloads, supports once and unsubscribe', () => {
    const bus = new EventBus<{ a: number; b: string }>();
    const a = vi.fn();
    const once = vi.fn();
    const off = bus.on('a', a);
    bus.once('b', once);
    bus.emit('a', 1);
    bus.emit('b', 'x');
    bus.emit('b', 'y');
    off();
    bus.emit('a', 2);
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(1);
    expect(once).toHaveBeenCalledTimes(1);
  });
});
