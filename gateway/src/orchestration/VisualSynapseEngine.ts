import type { SharedMemory } from './shared-memory';
import type { DomNode } from './DomSnapshotter';
import type { AstFingerprint } from './AstStructuralAnchor';

export interface SynapseLink {
  domTag: string;
  domName?: string;
  line: number;
  confidence: number;
}

/**
 * VisualSynapseEngine: The "Synapse" Algorithm.
 * Links visual DOM elements to their structural source code (AST fingerprints).
 */
export class VisualSynapseEngine {
  constructor(private memory: SharedMemory) {}

  /**
   * findSourceForDomNode: Attempts to find the source code line for a given DOM node.
   */
  public async findSourceForDomNode(filePath: string, node: DomNode): Promise<SynapseLink | null> {
    const synthesizedFp: AstFingerprint = {
      kind: this.mapDomToAstKind(node),
      name: node.name,
      ancestorKinds: node.children?.map(c => this.mapDomToAstKind(c)) || [], 
      structuralHash: node.visualHash || ''
    };

    const line = await this.memory.findNodeByFingerprint(filePath, synthesizedFp);

    if (line !== null) {
      return {
        domTag: node.tagName,
        domName: node.name,
        line: line,
        // Hardened Confidence: Reward structural precision
        confidence: node.name ? 0.95 : (node.visualHash ? 0.8 : 0.6)
      };
    }

    return null;
  }

  /**
   * mapDomToAstKind: Context-aware mapping of DOM elements to AST constructs.
   */
  private mapDomToAstKind(node: DomNode): string {
    const tagName = node.tagName;
    const map: Record<string, string> = {
      'BUTTON': 'MethodDeclaration',
      'A': 'ExportDeclaration',
      'FORM': 'ClassDeclaration',
      'INPUT': 'VariableDeclaration',
      'H1': 'ClassDeclaration',
      'NAV': 'ModuleDeclaration'
    };
    
    // Future: Add Semantic Pattern Matching (e.g. if text contains 'submit' -> Function)
    return map[tagName] || 'Expression';
  }
}
