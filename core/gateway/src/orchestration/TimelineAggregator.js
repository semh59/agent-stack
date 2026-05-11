"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimelineAggregator = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const event_bus_1 = require("./event-bus");
/**
 * TimelineAggregator: Collects events from the EventBus and persists them to a unified log.
 * Acts as the "Black Box" for the entire agentic orchestration.
 */
class TimelineAggregator {
    logPath;
    currentRole = 'system';
    currentEpoch = 0;
    isDisposed = false;
    writeQueue = [];
    isProcessing = false;
    unsubscribe = null;
    constructor(rootDir, sessionId) {
        this.logPath = path.join(rootDir, '.ai-company', 'logs', sessionId, 'timeline.jsonl');
    }
    async init() {
        await fs.mkdir(path.dirname(this.logPath), { recursive: true });
        // Subscribe to all events
        this.unsubscribe = event_bus_1.eventBus.subscribe('*', (wrapped) => {
            this.pushEvent(wrapped.event, wrapped.data);
        });
    }
    setContext(role, epoch) {
        this.currentRole = role;
        this.currentEpoch = epoch;
    }
    pushEvent(type, data) {
        const event = {
            id: Math.random().toString(36).slice(2),
            timestamp: new Date().toISOString(),
            type,
            role: this.currentRole,
            epoch: this.currentEpoch,
            data
        };
        this.writeQueue.push(event);
        void this.processQueue();
    }
    async processQueue() {
        if (this.isProcessing || this.writeQueue.length === 0)
            return;
        this.isProcessing = true;
        while (this.writeQueue.length > 0) {
            const event = this.writeQueue.shift();
            try {
                const payload = this.safeStringify(event);
                const logDir = path.dirname(this.logPath);
                await fs.mkdir(logDir, { recursive: true }); // Ensure dir exists on every write for safety in tests
                await fs.appendFile(this.logPath, payload + '\n', 'utf-8');
            }
            catch (err) {
                console.error('[TimelineAggregator] Failed to write event:', err);
            }
        }
        this.isProcessing = false;
    }
    safeStringify(obj) {
        const cache = new Set();
        return JSON.stringify(obj, (key, value) => {
            if (typeof value === 'object' && value !== null) {
                if (cache.has(value))
                    return `[Circular]`;
                cache.add(value);
            }
            return value;
        });
    }
    dispose() {
        this.isDisposed = true;
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        // Clear queue to free memory
        this.writeQueue = [];
    }
}
exports.TimelineAggregator = TimelineAggregator;
//# sourceMappingURL=TimelineAggregator.js.map