import * as http from 'http';
import * as https from 'https';

export interface GatewayStatus {
  status: string;
  version?: string;
  bridge?: string;
}

export interface PipelineStartResult {
  sessionId?: string;
  status: string;
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

  async healthCheck(): Promise<GatewayStatus> {
    return this.get<GatewayStatus>('/api/health');
  }

  async startPipeline(userTask: string): Promise<PipelineStartResult> {
    return this.post<PipelineStartResult>('/api/pipelines/start', { userTask });
  }

  async addAccount(provider: string): Promise<{ url?: string }> {
    return this.post<{ url?: string }>('/api/accounts/add', { provider });
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, null);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private request<T>(method: string, path: string, body: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);
      const lib = url.protocol === 'https:' ? https : http;
      const payload = body != null ? JSON.stringify(body) : null;

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? '443' : '80'),
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.authToken ? { 'Authorization': `Bearer ${this.authToken}` } : {}),
          ...(payload ? { 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
        },
      };

      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as { data?: T } | T;
            const result = (parsed as { data?: T }).data ?? (parsed as T);
            if (res.statusCode !== undefined && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            } else {
              resolve(result);
            }
          } catch {
            reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(10_000, () => {
        req.destroy();
        reject(new Error('Gateway request timed out'));
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }
}
