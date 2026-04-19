import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from './event-bus';

describe('EventBus - Thread-Safe Operations', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new (EventBus as any)();
    // Reset singleton for testing
    (EventBus as any).instance = eventBus;
  });

  afterEach(() => {
    eventBus.clearAll();
  });

  describe('Unsubscribe Mechanism', () => {
    it('returns unsubscribe function from subscribe', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.subscribe('test-event', handler);

      expect(typeof unsubscribe).toBe('function');
    });

    it('unsubscribe removes handler from subscribers', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.subscribe('test-event', handler);

      eventBus.publish('test-event', { data: 'test' });
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      eventBus.publish('test-event', { data: 'test' });
      expect(handler).toHaveBeenCalledTimes(1); // No additional call
    });

    it('multiple unsubscribes are idempotent', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.subscribe('test-event', handler);

      unsubscribe();
      unsubscribe(); // Second call should not crash
      unsubscribe(); // Third call should not crash

      eventBus.publish('test-event', { data: 'test' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('unsubscribe removes event entry when no handlers left', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.subscribe('test-event', handler);

      expect(eventBus.getSubscriberCount('test-event')).toBe(1);

      unsubscribe();

      expect(eventBus.getSubscriberCount('test-event')).toBe(0);
    });

    it('prevents memory leaks by cleaning up after all handlers removed', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const unsub1 = eventBus.subscribe('event', handler1);
      const unsub2 = eventBus.subscribe('event', handler2);

      expect(eventBus.getTotalSubscriberCount()).toBe(2);

      unsub1();
      expect(eventBus.getTotalSubscriberCount()).toBe(1);

      unsub2();
      expect(eventBus.getTotalSubscriberCount()).toBe(0);
    });
  });

  describe('Thread-Safe Publishing (Copy-On-Iterate)', () => {
    it('handler unsubscribing itself during publish does not affect other handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn(() => {
        unsub1(); // Handler 2 unsubscribes handler 1
      });
      const handler3 = vi.fn();

      const unsub1 = eventBus.subscribe('event', handler1);
      eventBus.subscribe('event', handler2);
      eventBus.subscribe('event', handler3);

      eventBus.publish('event', { data: 'test' });

      // All handlers should be called in this publish
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler3).toHaveBeenCalledTimes(1);

      // After publish, handler1 is unsubscribed but other publishes should work
      eventBus.publish('event', { data: 'test2' });

      expect(handler1).toHaveBeenCalledTimes(1); // Not called again
      expect(handler2).toHaveBeenCalledTimes(2); // Called again
      expect(handler3).toHaveBeenCalledTimes(2); // Called again
    });

    it('new handlers registered during publish are not called in current publish', () => {
      let unsub2: any;
      const handler1 = vi.fn(() => {
        // Register new handler during publish
        unsub2 = eventBus.subscribe('event', handler2);
      });
      const handler2 = vi.fn();

      eventBus.subscribe('event', handler1);

      eventBus.publish('event', { data: 'test' });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(0); // Not called in first publish

      eventBus.publish('event', { data: 'test2' });

      expect(handler1).toHaveBeenCalledTimes(2);
      expect(handler2).toHaveBeenCalledTimes(1); // Called in second publish

      unsub2();
    });

    it('handles handler errors without breaking other handlers', () => {
      const handler1 = vi.fn(() => {
        throw new Error('Handler 1 error');
      });
      const handler2 = vi.fn();
      const handler3 = vi.fn(() => {
        throw new Error('Handler 3 error');
      });

      eventBus.subscribe('event', handler1);
      eventBus.subscribe('event', handler2);
      eventBus.subscribe('event', handler3);

      // Mock console.error to verify it's called
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      eventBus.publish('event', { data: 'test' });

      // All handlers should be called despite errors
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler3).toHaveBeenCalledTimes(1);

      // Errors should be caught and logged
      expect(consoleError).toHaveBeenCalledTimes(2);

      consoleError.mockRestore();
    });

    it('concurrent publish and subscribe do not cause race conditions', () => {
      const handlers = Array.from({ length: 10 }, () => vi.fn());

      // Subscribe all handlers
      handlers.forEach(handler => eventBus.subscribe('event', handler));

      // Simulate concurrent operations
      let newHandlerCalled = false;
      handlers[0]!.mockImplementation(() => {
        // During first handler execution, add new handler
        const newHandler = vi.fn(() => {
          newHandlerCalled = true;
        });
        eventBus.subscribe('event', newHandler);
      });

      eventBus.publish('event', { data: 'test' });

      // All original handlers called
      handlers.forEach(handler => {
        expect(handler).toHaveBeenCalledTimes(1);
      });

      // New handler not called in same publish (due to copy-on-iterate)
      expect(newHandlerCalled).toBe(false);

      // But new handler should be called in next publish
      eventBus.publish('event', { data: 'test2' });
      expect(newHandlerCalled).toBe(true);
    });
  });

  describe('Wildcard Events', () => {
    it('publishes to wildcard subscribers', () => {
      const handler = vi.fn();
      eventBus.subscribe('*', handler);

      eventBus.publish('custom:event', { data: 'test' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        event: 'custom:event',
        data: { data: 'test' },
        timestamp: expect.any(String),
      });
    });

    it('wildcard and specific event subscribers both receive events', () => {
      const wildcardHandler = vi.fn();
      const specificHandler = vi.fn();

      eventBus.subscribe('*', wildcardHandler);
      eventBus.subscribe('specific', specificHandler);

      eventBus.publish('specific', { data: 'test' });

      expect(wildcardHandler).toHaveBeenCalledTimes(1);
      expect(specificHandler).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe from wildcard event works', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.subscribe('*', handler);

      eventBus.publish('event1', {});
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      eventBus.publish('event2', {});
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Subscriber Monitoring', () => {
    it('getSubscriberCount returns correct count', () => {
      expect(eventBus.getSubscriberCount('event')).toBe(0);

      const unsub1 = eventBus.subscribe('event', vi.fn());
      expect(eventBus.getSubscriberCount('event')).toBe(1);

      eventBus.subscribe('event', vi.fn());
      expect(eventBus.getSubscriberCount('event')).toBe(2);

      unsub1();
      expect(eventBus.getSubscriberCount('event')).toBe(1);
    });

    it('getTotalSubscriberCount counts all subscribers', () => {
      expect(eventBus.getTotalSubscriberCount()).toBe(0);

      eventBus.subscribe('event1', vi.fn());
      expect(eventBus.getTotalSubscriberCount()).toBe(1);

      eventBus.subscribe('event2', vi.fn());
      expect(eventBus.getTotalSubscriberCount()).toBe(2);

      eventBus.subscribe('event1', vi.fn());
      expect(eventBus.getTotalSubscriberCount()).toBe(3);
    });
  });

  describe('Cleanup Operations', () => {
    it('clearEvent removes all subscribers for an event', () => {
      eventBus.subscribe('event1', vi.fn());
      eventBus.subscribe('event1', vi.fn());
      eventBus.subscribe('event2', vi.fn());

      expect(eventBus.getTotalSubscriberCount()).toBe(3);

      eventBus.clearEvent('event1');

      expect(eventBus.getSubscriberCount('event1')).toBe(0);
      expect(eventBus.getTotalSubscriberCount()).toBe(1);
    });

    it('clearAll removes all subscribers', () => {
      eventBus.subscribe('event1', vi.fn());
      eventBus.subscribe('event2', vi.fn());
      eventBus.subscribe('event3', vi.fn());

      expect(eventBus.getTotalSubscriberCount()).toBe(3);

      eventBus.clearAll();

      expect(eventBus.getTotalSubscriberCount()).toBe(0);
    });
  });

  describe('Defensive Checks', () => {
    it('rejects non-function handlers', () => {
      expect(() => {
        eventBus.subscribe('event', null as any);
      }).toThrow('Handler must be a function');

      expect(() => {
        eventBus.subscribe('event', undefined as any);
      }).toThrow('Handler must be a function');

      expect(() => {
        eventBus.subscribe('event', 'not a function' as any);
      }).toThrow('Handler must be a function');
    });

    it('publishes to non-existent events safely', () => {
      expect(() => {
        eventBus.publish('non-existent', { data: 'test' });
      }).not.toThrow();
    });
  });

  describe('Memory Safety', () => {
    it('does not leak memory with repeated subscribe/unsubscribe', () => {
      const handler = vi.fn();

      for (let i = 0; i < 100; i++) {
        const unsub = eventBus.subscribe('event', handler);
        unsub();
      }

      expect(eventBus.getTotalSubscriberCount()).toBe(0);
    });

    it('handles many concurrent handlers', () => {
      const handlers = Array.from({ length: 1000 }, () => vi.fn());

      handlers.forEach(handler => eventBus.subscribe('event', handler));

      expect(eventBus.getTotalSubscriberCount()).toBe(1000);

      eventBus.publish('event', { data: 'test' });

      handlers.forEach(handler => {
        expect(handler).toHaveBeenCalledTimes(1);
      });
    });
  });
});
