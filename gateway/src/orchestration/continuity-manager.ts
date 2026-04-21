import * as fs from 'fs/promises';
import path from 'path';

export interface WorkingMemory {
  currentFeature: string;
  filesModified: string[];
  decisions: string[];
  lastContextSnapshot: string;
  mistakesAndLearnings: string[];
}

/**
 * ContinuityManager: Agent'Ä±n 'Working Memory'sini kalÄ±cÄ± hale getirir.
 */
export class ContinuityManager {
  private memoryPath: string;

  constructor(memoryFile: string = '.agent/continuity.json') {
    this.memoryPath = path.resolve(process.cwd(), memoryFile);
  }

  /**
   * BelleÄŸi yÃ¼kler. Dosya yoksa default deÄŸerler dÃ¶ner.
   */
  public async loadMemory(): Promise<WorkingMemory> {
    try {
      const data = await fs.readFile(this.memoryPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return {
        currentFeature: '',
        filesModified: [],
        decisions: [],
        lastContextSnapshot: '',
        mistakesAndLearnings: []
      };
    }
  }

  /**
   * BelleÄŸi gÃ¼nceller.
   */
  public async updateMemory(update: Partial<WorkingMemory>): Promise<void> {
    const current = await this.loadMemory();
    
    // Dizileri birleÅŸtir, diÄŸerlerini gÃ¼ncelle
    const updated: WorkingMemory = {
      currentFeature: update.currentFeature ?? current.currentFeature,
      filesModified: Array.from(new Set([...current.filesModified, ...(update.filesModified ?? [])])),
      decisions: [...current.decisions, ...(update.decisions ?? [])],
      lastContextSnapshot: update.lastContextSnapshot ?? current.lastContextSnapshot,
      mistakesAndLearnings: current.mistakesAndLearnings
    };
    
    // KlasÃ¶rÃ¼n varlÄ±ÄŸÄ±ndan emin ol
    const dir = path.dirname(this.memoryPath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(this.memoryPath, JSON.stringify(updated, null, 2), 'utf8');
    console.log(`[Continuity] Memory updated at ${this.memoryPath}`);
  }

  /**
   * Yeni bir hata/Ã¶ÄŸrenim ekler.
   */
  public async addLearning(learning: string): Promise<void> {
    const memory = await this.loadMemory();
    memory.mistakesAndLearnings.push(learning);
    // Maksimum 100 Ã¶ÄŸrenim tut
    if (memory.mistakesAndLearnings.length > 100) memory.mistakesAndLearnings.shift();
    await this.updateMemory({ mistakesAndLearnings: memory.mistakesAndLearnings });
  }
}
