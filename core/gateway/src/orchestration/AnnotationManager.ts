import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import AsyncLock from 'async-lock';

export interface Annotation {
  id: string;
  line: number;
  snippet?: string; // Captured line content
  contextBefore?: string; // Line above
  contextAfter?: string; // Line below
  author: 'user' | 'agent' | 'system';
  content: string;
  timestamp: string;
  status: 'open' | 'resolved';
  replies: AnnotationReply[];
}

export interface AnnotationReply {
  id: string;
  author: 'user' | 'agent' | 'system';
  content: string;
  timestamp: string;
}

/**
 * AnnotationManager: Manages line-by-line comments as sidecar files.
 * Ensures artifacts remain clean while enabling deep collaboration.
 */
export class AnnotationManager {
  private baseDir: string;
  private lock = new AsyncLock();

  constructor(projectRoot: string) {
    this.baseDir = path.resolve(projectRoot, '.ai-company', 'annotations');
  }

  private getAnnotationPath(filePath: string): string {
    const hash = crypto.createHash('md5').update(filePath).digest('hex').slice(0, 8);
    const name = path.basename(filePath);
    return path.join(this.baseDir, `${name}.${hash}.annotations.json`);
  }

  public async getAnnotations(filePath: string): Promise<Annotation[]> {
    const annotationPath = this.getAnnotationPath(filePath);
    try {
      const data = await fs.readFile(annotationPath, 'utf-8');
      const annots = JSON.parse(data) as Annotation[];
      
      // OPTIONAL: Automatic Re-alignment check could happen here
      return annots;
    } catch {
      return [];
    }
  }

  public async addComment(filePath: string, line: number, author: 'user' | 'agent' | 'system', content: string): Promise<Annotation> {
    return this.lock.acquire(filePath, async () => {
      await fs.mkdir(this.baseDir, { recursive: true });
      const annotations = await this.getAnnotations(filePath);
      
      // Capture tri-line context for anchoring
      let snippet: string | undefined;
      let contextBefore: string | undefined;
      let contextAfter: string | undefined;

      try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const lines = fileContent.split('\n');
        snippet = lines[line - 1]?.trim();
        contextBefore = lines[line - 2]?.trim();
        contextAfter = lines[line]?.trim();
      } catch {}

      const newComment: Annotation = {
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

  public async resolveComment(filePath: string, annotationId: string): Promise<void> {
    return this.lock.acquire(filePath, async () => {
      const annotations = await this.getAnnotations(filePath);
      const annotation = annotations.find(a => a.id === annotationId);
      if (annotation) {
        annotation.status = 'resolved';
        await this.save(filePath, annotations);
      }
    });
  }

  public async addReply(filePath: string, annotationId: string, author: 'user' | 'agent' | 'system', content: string): Promise<void> {
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

  private async save(filePath: string, annotations: Annotation[]): Promise<void> {
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
  public async recalibrate(filePath: string): Promise<void> {
    return this.lock.acquire(filePath, async () => {
      const annotations = await this.getAnnotations(filePath);
      if (annotations.length === 0) return;

      try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const lines = fileContent.split('\n');
        let changed = false;

        for (const annot of annotations) {
          if (!annot.snippet) continue;

          // Highly precise 3-line check
          const isMatch = (idx: number) => {
             const mMain = lines[idx]?.trim() === annot.snippet;
             const mPre = !annot.contextBefore || lines[idx - 1]?.trim() === annot.contextBefore;
             const mPost = !annot.contextAfter || lines[idx + 1]?.trim() === annot.contextAfter;
             return mMain && mPre && mPost;
          };

          if (isMatch(annot.line - 1)) continue;

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
      } catch {}
    });
  }
}
