"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisualSynapseEngine = void 0;
/**
 * VisualSynapseEngine: The "Synapse" Algorithm.
 * Links visual DOM elements to their structural source code (AST fingerprints).
 */
class VisualSynapseEngine {
    memory;
    constructor(memory) {
        this.memory = memory;
    }
    /**
     * findSourceForDomNode: Attempts to find the source code line for a given DOM node.
     */
    async findSourceForDomNode(filePath, node) {
        const synthesizedFp = {
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
    mapDomToAstKind(node) {
        const tagName = node.tagName;
        const map = {
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
exports.VisualSynapseEngine = VisualSynapseEngine;
//# sourceMappingURL=VisualSynapseEngine.js.map