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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FsWatcher = void 0;
const chokidar_1 = __importDefault(require("chokidar"));
const event_bus_1 = require("./event-bus");
const path = __importStar(require("node:path"));
/**
 * FsWatcher: Monitors the project filesystem for changes and emits events to the EventBus.
 * High-performance implementation with strict exclusion rules.
 */
class FsWatcher {
    watcher = null;
    projectRoot;
    constructor(projectRoot) {
        this.projectRoot = path.resolve(projectRoot);
    }
    start() {
        if (this.watcher)
            return;
        this.watcher = chokidar_1.default.watch(this.projectRoot, {
            ignored: [
                '**/node_modules/**',
                '**/.git/**',
                '**/.ai-company/**',
                '**/dist/**',
                '**/.tmp/**',
                '**/package-lock.json'
            ],
            persistent: true,
            ignoreInitial: true,
            usePolling: true,
            interval: 100,
            awaitWriteFinish: {
                stabilityThreshold: 100,
                pollInterval: 50
            }
        });
        this.watcher
            .on('add', (pathStr) => this.emit('fs:add', pathStr))
            .on('change', (pathStr) => this.emit('fs:change', pathStr))
            .on('unlink', (pathStr) => this.emit('fs:unlink', pathStr))
            .on('error', (error) => console.error(`[FsWatcher] Error:`, error));
        console.log(`[FsWatcher] Started monitoring: ${this.projectRoot}`);
    }
    emit(event, pathStr) {
        const relativePath = path.relative(this.projectRoot, pathStr);
        event_bus_1.eventBus.publish(event, {
            path: relativePath,
            timestamp: new Date().toISOString()
        });
    }
    stop() {
        if (this.watcher) {
            void this.watcher.close();
            this.watcher = null;
        }
    }
}
exports.FsWatcher = FsWatcher;
//# sourceMappingURL=FsWatcher.js.map