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
exports.ResourceBackpressureController = void 0;
const os = __importStar(require("node:os"));
/**
 * ResourceBackpressureController: Implements dynamic QoS for the agent loop.
 * Throttles execution intensity based on host system telemetry.
 */
class ResourceBackpressureController {
    cpuThreshold;
    currentInterval = 100; // ms
    constructor(cpuThreshold = 0.8) {
        this.cpuThreshold = cpuThreshold;
    }
    /**
     * waitIfOverloaded: Blocks execution if system load exceeds threshold.
     * Implements an Exponential Backoff if pressure persists.
     */
    async waitIfOverloaded() {
        const load = await this.getCurrentLoad();
        const memRatio = 1 - (os.freemem() / os.totalmem());
        if (load > this.cpuThreshold || memRatio > 0.9) {
            console.warn(`[QoS] High Load Detected (${(load * 100).toFixed(1)}%). Throttling agent loop...`);
            await new Promise(resolve => setTimeout(resolve, this.currentInterval));
            // Gradually increase backoff up to 5 seconds
            this.currentInterval = Math.min(5000, this.currentInterval * 1.5);
        }
        else {
            // Cooldown: gradually reset interval
            this.currentInterval = Math.max(100, this.currentInterval * 0.5);
        }
    }
    /**
     * getCurrentLoad: Calculates current system load (Unix LoadAvg or Windows Delta Sample).
     */
    async getCurrentLoad() {
        const loads = os.loadavg();
        const unixLoad = (loads[0] || 0) / (os.cpus().length || 1);
        // Windows Fallback: Calculate load via CPU times delta if unixLoad is 0
        if (unixLoad === 0 || os.platform() === 'win32') {
            const initial = os.cpus();
            await new Promise(resolve => setTimeout(resolve, 100)); // Sample over 100ms
            const final = os.cpus();
            let totalIdle = 0, totalTick = 0;
            for (let i = 0; i < initial.length; i++) {
                const start = initial[i].times;
                const end = final[i].times;
                totalIdle += end.idle - start.idle;
                totalTick += (end.user - start.user) + (end.nice - start.nice) + (end.sys - start.sys) + (end.irq - start.irq) + (end.idle - start.idle);
            }
            return totalTick === 0 ? 0 : (totalTick - totalIdle) / totalTick;
        }
        return unixLoad;
    }
    /**
     * getAdaptivePollInterval: Recommended interval for FsWatcher.
     */
    getAdaptivePollInterval() {
        // Basic heuristic based on current throttle interval
        return this.currentInterval > 500 ? 1000 : 100;
    }
}
exports.ResourceBackpressureController = ResourceBackpressureController;
//# sourceMappingURL=ResourceBackpressureController.js.map