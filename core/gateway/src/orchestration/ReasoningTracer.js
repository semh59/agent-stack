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
exports.ReasoningTracer = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
/**
 * ReasoningTracer: Captures the "Why" behind agent generated content.
 * Links specific artifact lines to hidden agent reasoning.
 */
class ReasoningTracer {
    baseDir;
    constructor(projectRoot) {
        this.baseDir = path.resolve(projectRoot, '.ai-company', 'reasoning');
    }
    async trace(file, startLine, endLine, intent, alternatives = []) {
        await fs.mkdir(this.baseDir, { recursive: true });
        // Hash based indexing
        const tracePath = path.join(this.baseDir, `${path.basename(file)}.traces.json`);
        let traces = [];
        try {
            const data = await fs.readFile(tracePath, 'utf-8');
            traces = JSON.parse(data);
        }
        catch { }
        traces.push({
            file,
            range: { startLine, endLine },
            intent,
            alternativesConsidered: alternatives
        });
        await fs.writeFile(tracePath, JSON.stringify(traces, null, 2), 'utf-8');
    }
    async getReasoningForLine(file, line) {
        const tracePath = path.join(this.baseDir, `${path.basename(file)}.traces.json`);
        try {
            const data = await fs.readFile(tracePath, 'utf-8');
            const traces = JSON.parse(data);
            return traces.find(t => line >= t.range.startLine && line <= t.range.endLine) || null;
        }
        catch {
            return null;
        }
    }
    async clearTraces(file) {
        const tracePath = path.join(this.baseDir, `${path.basename(file)}.traces.json`);
        await fs.rm(tracePath, { force: true });
    }
}
exports.ReasoningTracer = ReasoningTracer;
//# sourceMappingURL=ReasoningTracer.js.map