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
exports.AnnotationManager = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const crypto = __importStar(require("node:crypto"));
const async_lock_1 = __importDefault(require("async-lock"));
/**
 * AnnotationManager: Manages line-by-line comments as sidecar files.
 * Ensures artifacts remain clean while enabling deep collaboration.
 */
class AnnotationManager {
    baseDir;
    lock = new async_lock_1.default();
    constructor(projectRoot) {
        this.baseDir = path.resolve(projectRoot, '.ai-company', 'annotations');
    }
    getAnnotationPath(filePath) {
        const hash = crypto.createHash('md5').update(filePath).digest('hex').slice(0, 8);
        const name = path.basename(filePath);
        return path.join(this.baseDir, `${name}.${hash}.annotations.json`);
    }
    async getAnnotations(filePath) {
        const annotationPath = this.getAnnotationPath(filePath);
        try {
            const data = await fs.readFile(annotationPath, 'utf-8');
            const annots = JSON.parse(data);
            // OPTIONAL: Automatic Re-alignment check could happen here
            return annots;
        }
        catch {
            return [];
        }
    }
    async addComment(filePath, line, author, content) {
        return this.lock.acquire(filePath, async () => {
            await fs.mkdir(this.baseDir, { recursive: true });
            const annotations = await this.getAnnotations(filePath);
            // Capture tri-line context for anchoring
            let snippet;
            let contextBefore;
            let contextAfter;
            try {
                const fileContent = await fs.readFile(filePath, 'utf-8');
                const lines = fileContent.split('\n');
                snippet = lines[line - 1]?.trim();
                contextBefore = lines[line - 2]?.trim();
                contextAfter = lines[line]?.trim();
            }
            catch { }
            const newComment = {
                id: Math.random().toString(36).slice(2, 10),
                line,
                snippet,
                contextBefore,
                contextAfter,
                author,
                content,
                timestamp: new Date().toISOString(),
                status: 'open',
                replies: []
            };
            annotations.push(newComment);
            await this.save(filePath, annotations);
            return newComment;
        });
    }
    async resolveComment(filePath, annotationId) {
        return this.lock.acquire(filePath, async () => {
            const annotations = await this.getAnnotations(filePath);
            const annotation = annotations.find(a => a.id === annotationId);
            if (annotation) {
                annotation.status = 'resolved';
                await this.save(filePath, annotations);
            }
        });
    }
    async addReply(filePath, annotationId, author, content) {
        return this.lock.acquire(filePath, async () => {
            const annotations = await this.getAnnotations(filePath);
            const annotation = annotations.find(a => a.id === annotationId);
            if (annotation) {
                annotation.replies.push({
                    id: Math.random().toString(36).slice(2, 10),
                    author,
                    content,
                    timestamp: new Date().toISOString()
                });
                await this.save(filePath, annotations);
            }
        });
    }
    async save(filePath, annotations) {
        const annotationPath = this.getAnnotationPath(filePath);
        const content = JSON.stringify(annotations, null, 2);
        // Atomic Write Pattern
        const tmpPath = `${annotationPath}.tmp.${Math.random().toString(36).slice(2)}`;
        await fs.writeFile(tmpPath, content, 'utf-8');
        await fs.rename(tmpPath, annotationPath);
    }
    /**
     * recalibrate: Attempts to find the new line numbers for annotations
     * after a file content change, using the stored snippets as anchors.
     */
    async recalibrate(filePath) {
        return this.lock.acquire(filePath, async () => {
            const annotations = await this.getAnnotations(filePath);
            if (annotations.length === 0)
                return;
            try {
                const fileContent = await fs.readFile(filePath, 'utf-8');
                const lines = fileContent.split('\n');
                let changed = false;
                for (const annot of annotations) {
                    if (!annot.snippet)
                        continue;
                    // Highly precise 3-line check
                    const isMatch = (idx) => {
                        const mMain = lines[idx]?.trim() === annot.snippet;
                        const mPre = !annot.contextBefore || lines[idx - 1]?.trim() === annot.contextBefore;
                        const mPost = !annot.contextAfter || lines[idx + 1]?.trim() === annot.contextAfter;
                        return mMain && mPre && mPost;
                    };
                    if (isMatch(annot.line - 1))
                        continue;
                    // Search range
                    const searchRange = 100;
                    const startSearch = Math.max(0, annot.line - 1 - searchRange);
                    const endSearch = Math.min(lines.length, annot.line - 1 + searchRange);
                    let found = false;
                    for (let i = startSearch; i < endSearch; i++) {
                        if (isMatch(i)) {
                            annot.line = i + 1;
                            changed = true;
                            found = true;
                            break;
                        }
                    }
                    // If not found via tri-line, try loose single-line match
                    if (!found) {
                        for (let i = startSearch; i < endSearch; i++) {
                            if (lines[i]?.trim() === annot.snippet) {
                                annot.line = i + 1;
                                changed = true;
                                break;
                            }
                        }
                    }
                }
                if (changed) {
                    await this.save(filePath, annotations);
                }
            }
            catch { }
        });
    }
}
exports.AnnotationManager = AnnotationManager;
//# sourceMappingURL=AnnotationManager.js.map