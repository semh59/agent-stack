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
exports.ContextOrchestrator = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
/**
 * ContextOrchestrator: Manages the Alloy Context Protocol (.context/).
 * Provides agents with spatially-aware long-term memory and ADR persistence.
 */
class ContextOrchestrator {
    contextDir;
    constructor(projectRoot) {
        this.contextDir = path.resolve(projectRoot, '.context');
    }
    async init() {
        await fs.mkdir(this.contextDir, { recursive: true });
    }
    /**
     * hydrateActiveTask: Updates the current execution state in .context.
     */
    async hydrateActiveTask(task) {
        const taskPath = path.join(this.contextDir, 'active_task.json');
        await fs.writeFile(taskPath, JSON.stringify(task, null, 2), 'utf-8');
    }
    /**
     * recordADR: Persists an Architectural Decision Record to the append-only ledger.
     */
    async recordADR(adr) {
        const adrPath = path.join(this.contextDir, 'adr.jsonl');
        const entry = JSON.stringify(adr) + '\n';
        await fs.appendFile(adrPath, entry, 'utf-8');
    }
    /**
     * getContextSnapshot: Returns a summary of all active context for agent injection.
     */
    async getContextSnapshot() {
        const snapshot = {};
        try {
            const taskData = await fs.readFile(path.join(this.contextDir, 'active_task.json'), 'utf-8');
            snapshot.activeTask = JSON.parse(taskData);
        }
        catch {
            snapshot.activeTask = null;
        }
        try {
            const adrData = await fs.readFile(path.join(this.contextDir, 'adr.jsonl'), 'utf-8');
            snapshot.recentDecisions = adrData.trim().split('\n').map(l => JSON.parse(l)).slice(-5);
        }
        catch {
            snapshot.recentDecisions = [];
        }
        return snapshot;
    }
}
exports.ContextOrchestrator = ContextOrchestrator;
//# sourceMappingURL=ContextOrchestrator.js.map