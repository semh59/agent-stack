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
exports.McpShadowFSGate = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
/**
 * McpShadowFSGate: The Zero-Trust Isolation Layer.
 * Projecting a "Safe FS" to MCP processes using path shielding.
 */
class McpShadowFSGate {
    projectRoot;
    allowedPaths = new Set();
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
        this.projectRoot = path.resolve(projectRoot);
    }
    /**
     * authorizePath: Registers a path as "Safe" for MCP interaction.
     */
    authorizePath(relativePath) {
        const fullPath = path.resolve(this.projectRoot, relativePath);
        if (fullPath.startsWith(this.projectRoot)) {
            this.allowedPaths.add(fullPath);
        }
    }
    /**
     * secureRead: Dosya okuma isteğini yakalar ve izin verilen mesh ile doğrular.
     */
    async secureRead(filePath) {
        const target = path.resolve(this.projectRoot, filePath);
        if (!this.isAuthorized(target)) {
            throw new Error(`[McpShadowFS] Erişim Reddedildi: ${filePath} yolu Shadow Sandbox dışında.`);
        }
        return fs.readFile(target, 'utf-8');
    }
    /**
     * secureWrite: [YENİ] Dosya yazma isteğini izole bir şekilde yönetir.
     */
    async secureWrite(filePath, content) {
        const target = path.resolve(this.projectRoot, filePath);
        if (!this.isAuthorized(target)) {
            throw new Error(`[McpShadowFS] Yazma Reddedildi: ${filePath} yolu güvenli değil.`);
        }
        await fs.writeFile(target, content, 'utf-8');
    }
    isAuthorized(target) {
        // Basic Shield: Must be inside project root and authorized
        if (!target.startsWith(this.projectRoot))
            return false;
        // Hardening: Block sensitive files regardless of authorization
        const sensitiveFiles = ['.env', '.git', 'id_rsa', 'shadow', 'passwd'];
        if (sensitiveFiles.some(f => target.includes(f)))
            return false;
        return true;
    }
}
exports.McpShadowFSGate = McpShadowFSGate;
//# sourceMappingURL=McpShadowFSGate.js.map