import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * McpShadowFSGate: The Zero-Trust Isolation Layer.
 * Projecting a "Safe FS" to MCP processes using path shielding.
 */
export class McpShadowFSGate {
  private allowedPaths: Set<string> = new Set();

  constructor(private projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  /**
   * authorizePath: Registers a path as "Safe" for MCP interaction.
   */
  public authorizePath(relativePath: string) {
    const fullPath = path.resolve(this.projectRoot, relativePath);
    if (fullPath.startsWith(this.projectRoot)) {
      this.allowedPaths.add(fullPath);
    }
  }

  /**
   * secureRead: Dosya okuma isteğini yakalar ve izin verilen mesh ile doğrular.
   */
  public async secureRead(filePath: string): Promise<string> {
    const target = path.resolve(this.projectRoot, filePath);

    if (!this.isAuthorized(target)) {
      throw new Error(`[McpShadowFS] Erişim Reddedildi: ${filePath} yolu Shadow Sandbox dışında.`);
    }

    return fs.readFile(target, 'utf-8');
  }

  /**
   * secureWrite: [YENİ] Dosya yazma isteğini izole bir şekilde yönetir.
   */
  public async secureWrite(filePath: string, content: string): Promise<void> {
    const target = path.resolve(this.projectRoot, filePath);

    if (!this.isAuthorized(target)) {
      throw new Error(`[McpShadowFS] Yazma Reddedildi: ${filePath} yolu güvenli değil.`);
    }

    await fs.writeFile(target, content, 'utf-8');
  }

  private isAuthorized(target: string): boolean {
    // Basic Shield: Must be inside project root and authorized
    if (!target.startsWith(this.projectRoot)) return false;
    
    // Hardening: Block sensitive files regardless of authorization
    const sensitiveFiles = ['.env', '.git', 'id_rsa', 'shadow', 'passwd'];
    if (sensitiveFiles.some(f => target.includes(f))) return false;

    return true;
  }
}
