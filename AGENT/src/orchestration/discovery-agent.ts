import * as fs from 'fs/promises';
import path from 'path';

export interface ProjectMap {
  techStack: string[];
  entryPoints: string[];
  components: string[];
  complexity: 'low' | 'medium' | 'high';
}

/**
 * DiscoveryAgent: Proje yapısını otonom olarak analiz eder.
 */
export class DiscoveryAgent {
  /**
   * Projeyi tarar ve bir harita oluşturur.
   */
  public async discover(rootPath: string): Promise<ProjectMap> {
    const map: ProjectMap = {
      techStack: [],
      entryPoints: [],
      components: [],
      complexity: 'low'
    };

    const files = await this.recursiveScan(rootPath);
    
    // 1. Tech Stack Belirleme
    if (files.includes('package.json')) map.techStack.push('Node.js');
    if (files.includes('tsconfig.json')) map.techStack.push('TypeScript');
    if (files.includes('requirements.txt')) map.techStack.push('Python');
    if (files.includes('docker-compose.yml')) map.techStack.push('Docker');

    // 2. Giriş Noktalarını Bulma
    const entryFiles = files.filter(f => 
      f.includes('index.ts') || f.includes('main.ts') || f.includes('server.ts') || f.includes('app.ts')
    );
    map.entryPoints.push(...entryFiles);

    // 3. Bileşenleri Haritalama
    const components = files.filter(f => f.includes('src/') && (f.endsWith('.ts') || f.endsWith('.tsx')));
    map.components.push(...components.slice(0, 50)); // İlk 50 bileşeni al

    // 4. Karmaşıklık Analizi
    if (files.length > 500) map.complexity = 'high';
    else if (files.length > 100) map.complexity = 'medium';

    console.log(`[Discovery] Mapping complete. Found ${files.length} files. Tech: ${map.techStack.join(', ')}`);
    return map;
  }

  private async recursiveScan(dir: string, results: string[] = [], depth: number = 0): Promise<string[]> {
    if (depth > 10) return results; // Güvenlik sınırı: 10 kat derinlik

    try {
      const list = await fs.readdir(dir, { withFileTypes: true });
      for (const file of list) {
        const res = path.resolve(dir, file.name);
        if (file.isDirectory()) {
          // Gizli klasörleri ve node_modules'u atla
          if (!file.name.startsWith('.') && file.name !== 'node_modules' && file.name !== 'dist') {
            await this.recursiveScan(res, results, depth + 1);
          }
        } else {
          results.push(path.relative(process.cwd(), res));
        }
      }
    } catch (error) {
      console.warn(`[Discovery] Could not scan directory ${dir}:`, error);
    }
    return results;
  }
}
