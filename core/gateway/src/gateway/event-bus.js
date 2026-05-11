"use strict";
/**
 * Unified Event Bus for Alloy AI Platform
 *
 * Typed event system replacing raw WebSocket JSON messages.
 * Uses discriminated unions with backpressure ring buffer.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalEventBus = exports.AlloyEventBus = void 0;
const events_1 = require("events");
const DEFAULT_CONFIG = {
    maxReplaySize: 50, // Keep last 50 events for new subscribers
    maxQueueSize: 1000, // Maximum pending events before dropping
};
class AlloyEventBus {
    emitter = new events_1.EventEmitter();
    config;
    // Replay buffer for state hydration
    replayBuffer = [];
    constructor(configOverrides) {
        this.config = { ...DEFAULT_CONFIG, ...configOverrides };
        this.emitter.setMaxListeners(50);
    }
    /** Emit a typed event to all listeners */
    emit(event, options) {
        // 1. Add to replay buffer (unless noReplay is set)
        if (!options?.noReplay) {
            this.replayBuffer.push(event);
            if (this.replayBuffer.length > this.config.maxReplaySize) {
                this.replayBuffer.shift();
            }
        }
        // 2. Broadcast
        this.emitter.emit(event.type, event);
        this.emitter.emit('*', event); // wildcard listeners
    }
    /** Listen to a specific event type */
    on(type, listener) {
        const wrapper = (e) => listener(e);
        this.emitter.on(type, wrapper);
        return () => this.emitter.off(type, wrapper);
    }
    /** Listen to all events (good for WebSocket broadcast) */
    onAll(listener) {
        this.emitter.on('*', listener);
        return () => this.emitter.off('*', listener);
    }
    /** Listen for one occurrence of an event */
    once(type, listener) {
        this.emitter.once(type, listener);
    }
    /** Get recent events for hydrating UI state */
    getReplayBuffer() {
        return [...this.replayBuffer];
    }
    /** Clear all listeners */
    dispose() {
        this.emitter.removeAllListeners();
        this.replayBuffer.length = 0;
    }
}
exports.AlloyEventBus = AlloyEventBus;
// Global Singleton Instance
exports.GlobalEventBus = new AlloyEventBus();
//# sourceMappingURL=event-bus.js.map