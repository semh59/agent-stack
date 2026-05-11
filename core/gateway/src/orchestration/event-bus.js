"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventBus = exports.EventBus = void 0;
class EventBus {
    static instance;
    handlers = new Map();
    deadLetters = [];
    maxDeadLetters = 100;
    constructor() { }
    static getInstance() {
        if (!EventBus.instance) {
            EventBus.instance = new EventBus();
        }
        return EventBus.instance;
    }
    publish(event, data) {
        const handlersToCall = new Set();
        const specificHandlers = this.handlers.get(event);
        if (specificHandlers) {
            specificHandlers.forEach(h => handlersToCall.add(h));
        }
        if (event !== '*') {
            const wildcardHandlers = this.handlers.get('*');
            if (wildcardHandlers) {
                const wildcardPayload = {
                    event,
                    data,
                    timestamp: new Date().toISOString()
                };
                wildcardHandlers.forEach(h => {
                    handlersToCall.add((_) => h(wildcardPayload));
                });
            }
        }
        handlersToCall.forEach(handler => {
            try {
                const result = handler(data);
                if (result instanceof Promise) {
                    result.catch(err => {
                        console.error(`[EventBus] Error in async handler for ${event}:`, err);
                        this.addDeadLetter(event, data, err);
                        if (event !== 'eventbus.error') {
                            this.publish('eventbus.error', { event, error: err });
                        }
                    });
                }
            }
            catch (err) {
                console.error(`[EventBus] Error in sync handler for ${event}:`, err);
                this.addDeadLetter(event, data, err);
            }
        });
    }
    subscribe(event, handler) {
        if (typeof handler !== 'function') {
            throw new Error(`Handler must be a function`);
        }
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        const currentHandlers = this.handlers.get(event);
        currentHandlers.add(handler);
        return () => {
            const handlers = this.handlers.get(event);
            if (handlers) {
                handlers.delete(handler);
                if (handlers.size === 0) {
                    this.handlers.delete(event);
                }
            }
        };
    }
    /**
     * Returns dead letters (events that failed to process).
     */
    getDeadLetters() {
        return this.deadLetters;
    }
    /**
     * Clears the dead letter queue.
     */
    clearDeadLetters() {
        this.deadLetters = [];
    }
    clearAll() {
        this.handlers.clear();
    }
    clearEvent(event) {
        this.handlers.delete(event);
    }
    getTotalSubscriberCount() {
        let count = 0;
        for (const subs of this.handlers.values()) {
            count += subs.size;
        }
        return count;
    }
    getSubscriberCount(event) {
        return this.handlers.get(event)?.size ?? 0;
    }
    addDeadLetter(event, data, error) {
        this.deadLetters.push({
            event,
            data,
            error,
            timestamp: new Date().toISOString()
        });
        // Ring buffer: keep only the most recent entries
        if (this.deadLetters.length > this.maxDeadLetters) {
            this.deadLetters = this.deadLetters.slice(-this.maxDeadLetters);
        }
    }
}
exports.EventBus = EventBus;
exports.eventBus = EventBus.getInstance();
//# sourceMappingURL=event-bus.js.map