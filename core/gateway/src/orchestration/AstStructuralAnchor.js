"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AstStructuralAnchor = void 0;
const ts_morph_1 = require("ts-morph");
/**
 * AstStructuralAnchor: Uses AST parsing to pin comments to code structures.
 * Survives formatting changes, line moves, and identifier renames.
 */
class AstStructuralAnchor {
    project;
    constructor() {
        this.project = new ts_morph_1.Project();
    }
    getFingerprint(filePath, line) {
        try {
            const sourceFile = this.project.addSourceFileAtPath(filePath);
            const nodesOnLine = sourceFile.getDescendants().filter(n => {
                try {
                    return n.getStartLineNumber() === line;
                }
                catch {
                    return false;
                }
            });
            if (nodesOnLine.length === 0)
                return null;
            // Type-safe initialization
            let significantNode = nodesOnLine[0];
            for (const node of nodesOnLine) {
                let current = node;
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
        }
        catch (e) {
            console.error('[AstStructuralAnchor] Fingerprint Error:', e);
            return null;
        }
        finally {
            const sf = this.project.getSourceFile(filePath);
            if (sf)
                this.project.removeSourceFile(sf);
        }
    }
    getNodeName(node) {
        // Portably check for getName without using any
        const n = node;
        if (typeof n.getName === 'function') {
            return n.getName();
        }
        return undefined;
    }
    getNodePriority(node) {
        const kind = node.getKindName();
        if (kind.includes('Declaration'))
            return 10;
        if (kind.includes('Method') || kind.includes('Function'))
            return 9;
        if (kind.includes('Class') || kind.includes('Interface'))
            return 8;
        if (kind.includes('Expression'))
            return 5;
        return 1;
    }
    findNodeByFingerprint(filePath, fingerprint) {
        try {
            const sourceFile = this.project.addSourceFileAtPath(filePath);
            const allNodes = sourceFile.getDescendants();
            let bestMatch = null;
            for (const node of allNodes) {
                const score = this.calculateMatchScore(node, fingerprint);
                if (score > 0.3 && (!bestMatch || score > bestMatch.score)) {
                    bestMatch = { node, score };
                }
            }
            return bestMatch ? bestMatch.node.getStartLineNumber() : null;
        }
        catch {
            return null;
        }
        finally {
            const sf = this.project.getSourceFile(filePath);
            if (sf)
                this.project.removeSourceFile(sf);
        }
    }
    getAncestors(node, depth) {
        const ancestors = [];
        let cur = node.getParent();
        for (let i = 0; i < depth && cur; i++) {
            ancestors.push(cur.getKindName());
            cur = cur.getParent();
        }
        return ancestors;
    }
    calculateStructuralHash(node) {
        return node.getChildren().map(c => c.getKindName()).join('|');
    }
    calculateMatchScore(node, fp) {
        let score = 0;
        const kind = node.getKindName();
        if (kind === fp.kind) {
            score += 0.5;
        }
        else if (this.isSemanticallyEquivalent(kind, fp.kind)) {
            score += 0.4;
        }
        const name = this.getNodeName(node);
        if (name && fp.name) {
            if (name === fp.name)
                score += 0.3;
            else if (name.toLowerCase().includes(fp.name.toLowerCase()) ||
                fp.name.toLowerCase().includes(name.toLowerCase())) {
                score += 0.15;
            }
        }
        const hash = this.calculateStructuralHash(node);
        if (hash === fp.structuralHash)
            score += 0.2;
        const ancestors = this.getAncestors(node, 3);
        const shared = ancestors.filter((a, i) => fp.ancestorKinds[i] === a).length;
        score += (shared / 3) * 0.1;
        return score;
    }
    isSemanticallyEquivalent(kind1, kind2) {
        const functionKinds = ['MethodDeclaration', 'FunctionDeclaration', 'ArrowFunction', 'VariableDeclaration'];
        const containerKinds = ['ClassDeclaration', 'InterfaceDeclaration', 'ModuleDeclaration', 'SourceFile'];
        if (functionKinds.includes(kind1) && functionKinds.includes(kind2))
            return true;
        if (containerKinds.includes(kind1) && containerKinds.includes(kind2))
            return true;
        return false;
    }
}
exports.AstStructuralAnchor = AstStructuralAnchor;
//# sourceMappingURL=AstStructuralAnchor.js.map