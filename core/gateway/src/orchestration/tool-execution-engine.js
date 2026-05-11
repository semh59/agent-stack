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
exports.StandaloneToolExecutionEngine = void 0;
const fs = __importStar(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const crypto = __importStar(require("node:crypto"));
const AutonomyPolicyEngine_1 = require("./policy/AutonomyPolicyEngine");
/**
 * StandaloneToolExecutionEngine: Node.js-only implementation.
 * Uses fs/promises â€” no VSCode dependency.
 * Includes realpath traversal protection.
 */
class StandaloneToolExecutionEngine {
    projectRoot;
    onApprovalRequired;
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
    }
    setApprovalHandler(handler) {
        this.onApprovalRequired = handler;
    }
    async requestApproval(action, context) {
        // Proactive Policy Check
        const violations = AutonomyPolicyEngine_1.autonomyPolicyEngine.evaluate({
            toolName: context?.toolName ?? 'unknown',
            args: context?.args ?? {},
            confidence: context?.confidence ?? 1.0,
            filePath: context?.filePath,
            command: context?.command,
        });
        const needsPause = violations.some(v => v.action === 'PAUSE');
        const isBlocked = violations.some(v => v.action === 'BLOCK');
        if (isBlocked) {
            throw new Error(`POLICY_BLOCK: ${violations.find(v => v.action === 'BLOCK')?.reason}`);
        }
        if (needsPause || this.onApprovalRequired) {
            if (this.onApprovalRequired) {
                const id = crypto.randomUUID();
                const reason = violations.map(v => v.reason).join('; ');
                return await this.onApprovalRequired({ id, action: reason || action });
            }
            // If no handler but needs pause, we must fail (conservative safety)
            if (needsPause) {
                throw new Error(`POLICY_PAUSE: Manual approval required but no handler registered. ${violations[0]?.reason}`);
            }
        }
        return true;
    }
    async readFile(filePath) {
        try {
            const absolutePath = await this.resolvePath(filePath);
            const content = await fs.readFile(absolutePath, 'utf-8');
            return { success: true, output: content };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `Error reading file: ${msg}` };
        }
    }
    async writeFile(filePath, content) {
        try {
            if (!(await this.requestApproval(`Write file: ${filePath}`, {
                toolName: 'write_to_file',
                filePath,
                args: { content },
                confidence: 1.0
            }))) {
                return { success: false, output: 'Action rejected by user.' };
            }
            const absolutePath = await this.resolvePath(filePath);
            const dir = node_path_1.default.dirname(absolutePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(absolutePath, content, 'utf-8');
            return { success: true, output: `File written successfully: ${filePath}` };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `Error writing file: ${msg}` };
        }
    }
    async listFiles(dirPath) {
        try {
            const absolutePath = await this.resolvePath(dirPath);
            const entries = await fs.readdir(absolutePath, { withFileTypes: true });
            const output = entries
                .map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`)
                .join('\n');
            return { success: true, output };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `Error listing files: ${msg}` };
        }
    }
    async runCommand(command) {
        try {
            if (!(await this.requestApproval(`Run command: ${command}`, {
                toolName: 'run_command',
                command,
                args: {},
                confidence: 1.0
            }))) {
                return { success: false, output: 'Command rejected by user.' };
            }
            return { success: true, output: 'Command approved' };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `Policy Error: ${msg}` };
        }
    }
    /**
     * Resolve path with realpath traversal protection.
     */
    async resolvePath(relativePath) {
        const rootReal = await fs.realpath(this.projectRoot);
        const targetPath = node_path_1.default.resolve(this.projectRoot, relativePath);
        let targetReal = null;
        try {
            targetReal = await fs.realpath(targetPath);
        }
        catch {
            // File doesn't exist yet — verify parent is inside workspace
            let current = targetPath;
            while (current !== node_path_1.default.dirname(current)) {
                const parent = node_path_1.default.dirname(current);
                try {
                    const parentReal = await fs.realpath(parent);
                    const isInside = parentReal.startsWith(rootReal + node_path_1.default.sep) || parentReal === rootReal;
                    if (!isInside) {
                        throw new Error(`SECURITY_BLOCK: Path "${relativePath}" resolves outside the workspace`);
                    }
                    return targetPath;
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg.startsWith('SECURITY_BLOCK'))
                        throw err;
                    current = parent;
                }
            }
            throw new Error(`SECURITY_BLOCK: Path "${relativePath}" resolves outside the workspace`);
        }
        const isInside = targetReal.startsWith(rootReal + node_path_1.default.sep) || targetReal === rootReal;
        if (!isInside) {
            throw new Error(`SECURITY_BLOCK: Path traversal attempt detected for "${relativePath}"`);
        }
        return targetReal;
    }
}
exports.StandaloneToolExecutionEngine = StandaloneToolExecutionEngine;
//# sourceMappingURL=tool-execution-engine.js.map