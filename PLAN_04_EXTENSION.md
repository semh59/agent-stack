# Plan 04 — VS Code Extension: %40 → %100

## Mevcut Durum
`interface/extension/` altında `src/` klasörü yok — sadece `node_modules`.
Extension'ın TypeScript kaynak dosyaları yazılmamış. Node modülleri kurulu.

## Kabul Kriterleri
```bash
cd interface/extension
npm run compile    # 0 hata
npm test           # 0 failure
# VS Code'da F5 → Extension Development Host açılır
# Komut paletinde "Alloy: ..." komutları görünür
```

---

## Görev 1 — Proje iskeletini kur

### 1a. `package.json` oluştur (yoksa)
```bash
ls interface/extension/package.json
```

Yoksa:
```json
{
  "name": "alloy-vscode",
  "displayName": "Alloy AI Platform",
  "description": "Token optimizasyonu ve multi-provider routing için VS Code entegrasyonu",
  "version": "0.1.0",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "alloy.optimize",
        "title": "Alloy: Aktif dosyayı optimize et"
      },
      {
        "command": "alloy.showStatus",
        "title": "Alloy: Durum göster"
      },
      {
        "command": "alloy.openDashboard",
        "title": "Alloy: Dashboard'u aç"
      }
    ],
    "configuration": {
      "title": "Alloy",
      "properties": {
        "alloy.gatewayUrl": {
          "type": "string",
          "default": "http://localhost:3000",
          "description": "Gateway URL"
        },
        "alloy.authToken": {
          "type": "string",
          "default": "",
          "description": "Gateway auth token"
        },
        "alloy.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Alloy optimizasyonunu etkinleştir"
        }
      }
    }
  },
  "scripts": {
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "test": "node ./out/test/runTest.js",
    "lint": "eslint src --ext ts"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0"
  }
}
```

### 1b. `tsconfig.json` oluştur
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2020",
    "outDir": "./out",
    "rootDir": "./src",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", ".vscode-test"]
}
```

---

## Görev 2 — `src/extension.ts` — Ana giriş noktası

**Oluştur:** `interface/extension/src/extension.ts`

```typescript
import * as vscode from 'vscode';
import { GatewayClient } from './gateway-client';
import { StatusBarManager } from './status-bar';
import { OptimizeCommand } from './commands/optimize';

let statusBar: StatusBarManager;
let gatewayClient: GatewayClient;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('alloy');
  const gatewayUrl = config.get<string>('gatewayUrl', 'http://localhost:3000');
  const authToken  = config.get<string>('authToken', '');

  gatewayClient = new GatewayClient(gatewayUrl, authToken);
  statusBar = new StatusBarManager(context);

  // Health check — gateway ayakta mı?
  try {
    await gatewayClient.healthCheck();
    statusBar.setConnected();
  } catch {
    statusBar.setDisconnected();
  }

  // Komutları kaydet
  context.subscriptions.push(
    vscode.commands.registerCommand('alloy.optimize', async () => {
      const cmd = new OptimizeCommand(gatewayClient);
      await cmd.execute();
    }),
    vscode.commands.registerCommand('alloy.showStatus', async () => {
      const status = await gatewayClient.getStatus();
      vscode.window.showInformationMessage(
        `Alloy: ${JSON.stringify(status, null, 2)}`
      );
    }),
    vscode.commands.registerCommand('alloy.openDashboard', () => {
      const dashUrl = gatewayUrl.replace(':3000', ':5173');  // Vite dev server
      vscode.env.openExternal(vscode.Uri.parse(dashUrl));
    }),
  );

  // Config değişikliklerini izle
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('alloy')) {
        const newUrl   = vscode.workspace.getConfiguration('alloy').get<string>('gatewayUrl', 'http://localhost:3000');
        const newToken = vscode.workspace.getConfiguration('alloy').get<string>('authToken', '');
        gatewayClient.updateConfig(newUrl, newToken);
      }
    })
  );
}

export function deactivate(): void {
  statusBar?.dispose();
}
```

---

## Görev 3 — `src/gateway-client.ts` — Gateway HTTP istemcisi

**Oluştur:** `interface/extension/src/gateway-client.ts`

```typescript
import * as https from 'https';
import * as http from 'http';

export interface GatewayStatus {
  status: string;
  version?: string;
  bridge?: string;
}

export interface OptimizeRequest {
  message: string;
  context_messages?: string[];
}

export interface OptimizeResult {
  optimized: string;
  savings_percent: number;
  cache_hit: boolean;
  layers: string[];
  model: string;
  tokens: { original: number; sent: number };
}

export class GatewayClient {
  private baseUrl: string;
  private authToken: string;

  constructor(baseUrl: string, authToken: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.authToken = authToken;
  }

  updateConfig(baseUrl: string, authToken: string): void {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.authToken = authToken;
  }

  async healthCheck(): Promise<void> {
    await this.get<{ status: string }>('/api/health');
  }

  async getStatus(): Promise<GatewayStatus> {
    return this.get<GatewayStatus>('/api/health');
  }

  async optimize(req: OptimizeRequest): Promise<OptimizeResult> {
    return this.post<OptimizeResult>('/api/bridge/optimize', req);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, null);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private request<T>(method: string, path: string, body: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);
      const lib = url.protocol === 'https:' ? https : http;

      const payload = body ? JSON.stringify(body) : null;
      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.authToken ? `Bearer ${this.authToken}` : '',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      };

      const req = lib.request(options, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as { data?: T } | T;
            // Gateway response envelope: { data: T, ... }
            const result = (parsed as { data?: T }).data ?? parsed as T;
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            } else {
              resolve(result);
            }
          } catch {
            reject(new Error(`Invalid JSON: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(10_000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (payload) req.write(payload);
      req.end();
    });
  }
}
```

---

## Görev 4 — `src/status-bar.ts` — Durum çubuğu

**Oluştur:** `interface/extension/src/status-bar.ts`

```typescript
import * as vscode from 'vscode';

export class StatusBarManager {
  private item: vscode.StatusBarItem;

  constructor(context: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'alloy.showStatus';
    this.item.tooltip = 'Alloy AI Platform';
    this.item.show();
    context.subscriptions.push(this.item);
  }

  setConnected(): void {
    this.item.text  = '$(check) Alloy';
    this.item.color = new vscode.ThemeColor('statusBarItem.foreground');
  }

  setDisconnected(): void {
    this.item.text  = '$(warning) Alloy (bağlı değil)';
    this.item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
  }

  setWorking(): void {
    this.item.text = '$(loading~spin) Alloy';
  }

  dispose(): void {
    this.item.dispose();
  }
}
```

---

## Görev 5 — `src/commands/optimize.ts` — Optimize komutu

**Oluştur:** `interface/extension/src/commands/optimize.ts`

```typescript
import * as vscode from 'vscode';
import { GatewayClient } from '../gateway-client';

export class OptimizeCommand {
  constructor(private client: GatewayClient) {}

  async execute(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Alloy: Aktif editör yok.');
      return;
    }

    const selection = editor.selection;
    const text = selection.isEmpty
      ? editor.document.getText()
      : editor.document.getText(selection);

    if (!text.trim()) {
      vscode.window.showWarningMessage('Alloy: Optimize edilecek metin yok.');
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Alloy: Optimize ediliyor...',
        cancellable: false,
      },
      async () => {
        try {
          const result = await this.client.optimize({ message: text });
          const savings = result.savings_percent.toFixed(1);

          const choice = await vscode.window.showInformationMessage(
            `Alloy: %${savings} tasarruf (${result.tokens.original} → ${result.tokens.sent} token). Değiştir?`,
            'Evet, değiştir',
            'Sadece göster',
            'İptal'
          );

          if (choice === 'Evet, değiştir') {
            await editor.edit(editBuilder => {
              const range = selection.isEmpty
                ? new vscode.Range(
                    editor.document.positionAt(0),
                    editor.document.positionAt(editor.document.getText().length)
                  )
                : selection;
              editBuilder.replace(range, result.optimized);
            });
          } else if (choice === 'Sadece göster') {
            const doc = await vscode.workspace.openTextDocument({
              content: result.optimized,
              language: editor.document.languageId,
            });
            await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
          }
        } catch (err) {
          vscode.window.showErrorMessage(`Alloy hatası: ${String(err)}`);
        }
      }
    );
  }
}
```

---

## Görev 6 — Temel test

**Oluştur:** `interface/extension/src/test/extension.test.ts`

```typescript
import * as assert from 'assert';
import { GatewayClient } from '../gateway-client';

suite('GatewayClient', () => {
  test('updateConfig değerleri günceller', () => {
    const client = new GatewayClient('http://localhost:3000', 'token1');
    client.updateConfig('http://localhost:4000', 'token2');
    // private alanlara erişemiyoruz, sadece crash olmadığını doğrula
    assert.ok(client);
  });
});
```

---

## Görev 7 — Derle ve doğrula

```bash
cd interface/extension
npm install
npm run compile
```

**0 hata olmalı.**

---

## Son Kontrol Listesi
- [ ] `npm run compile` → hata yok
- [ ] `src/extension.ts` mevcut ve export { activate, deactivate }
- [ ] `src/gateway-client.ts` mevcut, health/optimize çağrıları var
- [ ] `src/status-bar.ts` mevcut
- [ ] `src/commands/optimize.ts` mevcut
- [ ] VS Code'da F5 → Extension geliştirme host'u açılır
- [ ] Komut paletinde "Alloy: " komutları görünür
