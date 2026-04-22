import ts from 'typescript';

/**
 * AST Indexer: Proje kodlarÄ±nÄ± yapÄ±sal (AST) olarak analiz eder.
 * Kod parÃ§alarÄ±nÄ± sadece metin olarak deÄŸil, semantik anlamlarÄ±yla (fonksiyon, sÄ±nÄ±f, deÄŸiÅŸken) bulur.
 */
export class ASTIndexer {
  private program: ts.Program;
  private checker: ts.TypeChecker;

  constructor(rootFiles: string[]) {
    this.program = ts.createProgram(rootFiles, {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      allowJs: true,
    });
    this.checker = this.program.getTypeChecker();
  }

  /**
   * TÃ¼m dosyalarÄ± tarar ve semantik bir sembol listesi Ã§Ä±karÄ±r.
   */
  public indexProject() {
    const symbols: Record<string, unknown>[] = [];
    for (const sourceFile of this.program.getSourceFiles()) {
      if (!sourceFile.isDeclarationFile) {
        ts.forEachChild(sourceFile, (node) => {
          this.visitNode(node, sourceFile, symbols);
        });
      }
    }
    return symbols;
  }

  private visitNode(node: ts.Node, sourceFile: ts.SourceFile, symbols: Record<string, unknown>[]) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      symbols.push(this.extractSymbolInfo(node, 'Function', sourceFile));
    } else if (ts.isClassDeclaration(node) && node.name) {
      symbols.push(this.extractSymbolInfo(node, 'Class', sourceFile));
    } else if (ts.isInterfaceDeclaration(node) && node.name) {
      symbols.push(this.extractSymbolInfo(node, 'Interface', sourceFile));
    }

    ts.forEachChild(node, (child) => this.visitNode(child, sourceFile, symbols));
  }

  private extractSymbolInfo(node: ts.NamedDeclaration, type: string, sourceFile: ts.SourceFile) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    return {
      name: node.name?.getText(sourceFile),
      type,
      path: sourceFile.fileName,
      line: line + 1,
      character: character + 1,
      snippet: node.getText(sourceFile).substring(0, 100) + '...',
    };
  }

  /**
   * Belirli bir sembolÃ¼ (Ã¶rneÄŸin bir fonksiyon adÄ±) tÃ¼m projede arar.
   */
  public searchSymbol(query: string) {
    const allSymbols = this.indexProject();
    return allSymbols.filter(s => s.name?.toLowerCase().includes(query.toLowerCase()));
  }
}

// Ã–rnek kullanÄ±m (Agent iÃ§inde tool olarak Ã§aÄŸrÄ±lacak)
// const indexer = new ASTIndexer(['src/index.ts']);
// console.log(indexer.searchSymbol('authorize'));
