import { Project } from 'ts-morph';
import type { Node } from 'ts-morph';

export interface AstFingerprint {
  kind: string;
  name?: string;
  parentKind?: string;
  ancestorKinds: string[]; // Up to 3 levels
  structuralHash: string; // Hash of children's syntax kinds
}

/**
 * AstStructuralAnchor: Uses AST parsing to pin comments to code structures.
 * Survives formatting changes, line moves, and identifier renames.
 */
export class AstStructuralAnchor {
  private project: Project;

  constructor() {
    this.project = new Project();
  }

  public getFingerprint(filePath: string, line: number): AstFingerprint | null {
    try {
      const sourceFile = this.project.addSourceFileAtPath(filePath);
      
      const nodesOnLine = sourceFile.getDescendants().filter(n => {
        try {
          return n.getStartLineNumber() === line;
        } catch {
          return false;
        }
      });

      if (nodesOnLine.length === 0) return null;

      // Type-safe initialization
      let significantNode: Node = nodesOnLine[0]!;
      for (const node of nodesOnLine) {
        let current: Node = node;
        let parent = node.getParent();
        while (parent && parent.getStartLineNumber() === line) {
          current = parent;
          parent = parent.getParent();
        }

        if (this.getNodePriority(current) > this.getNodePriority(significantNode)) {
          significantNode = current;
        }
      }

      return {
        kind: significantNode.getKindName(),
        name: this.getNodeName(significantNode),
        parentKind: significantNode.getParent()?.getKindName(),
        ancestorKinds: this.getAncestors(significantNode, 3),
        structuralHash: this.calculateStructuralHash(significantNode)
      };
    } catch (e) {
       console.error('[AstStructuralAnchor] Fingerprint Error:', e);
       return null;
    } finally {
      const sf = this.project.getSourceFile(filePath);
      if (sf) this.project.removeSourceFile(sf);
    }
  }

  private getNodeName(node: Node): string | undefined {
    // Portably check for getName without using any
    if ((node as any).getName && typeof (node as any).getName === 'function') {
      return (node as any).getName();
    }
    return undefined;
  }

  private getNodePriority(node: Node): number {
    const kind = node.getKindName();
    if (kind.includes('Declaration')) return 10;
    if (kind.includes('Method') || kind.includes('Function')) return 9;
    if (kind.includes('Class') || kind.includes('Interface')) return 8;
    if (kind.includes('Expression')) return 5;
    return 1;
  }

  public findNodeByFingerprint(filePath: string, fingerprint: AstFingerprint): number | null {
    try {
      const sourceFile = this.project.addSourceFileAtPath(filePath);
      const allNodes = sourceFile.getDescendants();

      let bestMatch: { node: Node, score: number } | null = null;

      for (const node of allNodes) {
        const score = this.calculateMatchScore(node, fingerprint);
        if (score > 0.3 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { node, score };
        }
      }

      return bestMatch ? bestMatch.node.getStartLineNumber() : null;
    } catch {
      return null;
    } finally {
      const sf = this.project.getSourceFile(filePath);
      if (sf) this.project.removeSourceFile(sf);
    }
  }

  private getAncestors(node: Node, depth: number): string[] {
    const ancestors: string[] = [];
    let cur = node.getParent();
    for (let i = 0; i < depth && cur; i++) {
       ancestors.push(cur.getKindName());
       cur = cur.getParent();
    }
    return ancestors;
  }

  private calculateStructuralHash(node: Node): string {
    return node.getChildren().map(c => c.getKindName()).join('|');
  }

  private calculateMatchScore(node: Node, fp: AstFingerprint): number {
    let score = 0;
    const kind = node.getKindName();
    
    if (kind === fp.kind) {
      score += 0.5;
    } else if (this.isSemanticallyEquivalent(kind, fp.kind)) {
      score += 0.4;
    }

    const name = this.getNodeName(node);
    if (name && fp.name) {
      if (name === fp.name) score += 0.3;
      else if (name.toLowerCase().includes(fp.name.toLowerCase()) || 
               fp.name.toLowerCase().includes(name.toLowerCase())) {
        score += 0.15;
      }
    }
    
    const hash = this.calculateStructuralHash(node);
    if (hash === fp.structuralHash) score += 0.2;

    const ancestors = this.getAncestors(node, 3);
    const shared = ancestors.filter((a, i) => fp.ancestorKinds[i] === a).length;
    score += (shared / 3) * 0.1;

    return score;
  }

  private isSemanticallyEquivalent(kind1: string, kind2: string): boolean {
    const functionKinds = ['MethodDeclaration', 'FunctionDeclaration', 'ArrowFunction', 'VariableDeclaration'];
    const containerKinds = ['ClassDeclaration', 'InterfaceDeclaration', 'ModuleDeclaration', 'SourceFile'];
    
    if (functionKinds.includes(kind1) && functionKinds.includes(kind2)) return true;
    if (containerKinds.includes(kind1) && containerKinds.includes(kind2)) return true;
    
    return false;
  }
}
