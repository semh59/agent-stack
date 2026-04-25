import type { Page } from 'playwright';

export interface DomNode {
  tagName: string;
  role?: string;
  name?: string;
  text?: string;
  bbox?: { x: number, y: number, width: number, height: number };
  visualHash?: string; // Perceptual hash for regression tracking
  children?: DomNode[];
}

/**
 * DomSnapshotter: Translates raw DOM into an "Agent-Readable" Accessibility Tree.
 * Bypasses instrumentation conflicts by using string-shielded execution.
 */
export class DomSnapshotter {
  constructor() {}

  public async captureSnapshot(page: Page): Promise<DomNode[]> {
    const script = `
      (function() {
        function walk(node) {
          const role = node.getAttribute('role') || '';
          const nameAttr = node.getAttribute('aria-label') || node.getAttribute('name') || '';
          const textContent = node.textContent?.slice(0, 50).trim() || '';
          const name = nameAttr || textContent || undefined;

          const interestingTags = ['BUTTON', 'A', 'INPUT', 'SELECT', 'H1', 'H2', 'H3', 'NAV', 'HEADER', 'FOOTER'];
          const isInteresting = interestingTags.includes(node.tagName) || node.hasAttribute('onclick') || role;
          
          const rect = node.getBoundingClientRect();
          const bbox = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          if (bbox.width === 0 || bbox.height === 0) return null;

          // Performance Fix: Only compute styles for interesting candidates
          if (isInteresting) {
            const style = window.getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return null;
          }

          const children = [];
          let childHashes = '';

          // Shadow DOM Penetration
          const possibleNodes = [...node.children];
          if (node.shadowRoot) {
            possibleNodes.push(...node.shadowRoot.children);
          }

          for (let i = 0; i < possibleNodes.length; i++) {
             const sub = walk(possibleNodes[i]);
             if (sub) {
               children.push(sub);
               childHashes += sub.visualHash || '';
             }
          }

          if (!isInteresting && children.length === 0) return null;

          // Hardened Topological pHash (Includes Bbox for uniqueness)
          const rawHash = [node.tagName, role, nameAttr, textContent, childHashes, rect.x, rect.y].join('|');
          let h = 0;
          for (let i = 0; i < rawHash.length; i++) {
            h = ((h << 5) - h) + rawHash.charCodeAt(i);
            h |= 0;
          }
          const visualHash = h.toString(16);

          return {
            tagName: node.tagName,
            role: role,
            name: name,
            bbox: bbox,
            visualHash: visualHash,
            children: children.length > 0 ? children : undefined
          };
        }

        const root = walk(document.body);
        return root ? [root] : [];
      })()
    `;
    return page.evaluate(script);
  }
}
