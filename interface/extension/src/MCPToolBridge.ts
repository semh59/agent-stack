import * as vscode from 'vscode';
import WS from 'ws';
import { GlobalEventBus } from '../../src/gateway/event-bus';

export class MCPToolBridge {
  private readonly websocketUrl: string;
  private socket: WS | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isDisposed = false;

  constructor(port: number = 51122) {
    // Reverse channel: We connect UP to the Gateway/Bridge
    this.websocketUrl = `ws://127.0.0.1:${port}/ws/mcp-reverse`;
  }

  public connect() {
    try {
      this.socket = new WS(this.websocketUrl);

      this.socket.on('open', () => {
        GlobalEventBus.emit({
          type: "ui:log",
          id: Date.now(),
          time: new Date().toISOString(),
          source: "MCPToolBridge",
          text: "Connected to MCP reverse channel",
          level: "success"
        });
        this.registerTools();
      });

      this.socket.on('message', async (data: WS.RawData) => {
        try {
          const req = JSON.parse(data.toString());
          if (req.method === 'executeTool') {
            const res = await this.executeTool(req.toolName, req.args);
            this.socket?.send(JSON.stringify({ id: req.id, result: res }));
          }
        } catch (err) {
          console.error("MCPToolBridge Message Error", err);
        }
      });

      this.socket.on('close', () => {
        if (!this.isDisposed) {
          this.reconnectTimer = setTimeout(() => this.connect(), 5000);
        }
      });

      this.socket.on('error', (err: Error) => {
        console.warn('[MCPToolBridge] Connection error:', err.message);
        // onclose will fire next and handle reconnect
      });

    } catch {
      if (!this.isDisposed) {
        this.reconnectTimer = setTimeout(() => this.connect(), 5000);
      }
    }
  }

  private registerTools() {
    const payload = {
      method: "register",
      tools: [
        { name: "vscode.get_active_document", description: "Get active editor content" },
        { name: "vscode.get_workspace_files", description: "List files" },
        { name: "vscode.apply_edit", description: "Apply text edits" }
      ]
    };
    this.socket?.send(JSON.stringify(payload));
  }

  private async executeTool(name: string, args: any): Promise<any> {
    switch (name) {
      case "vscode.get_active_document": {
        const doc = vscode.window.activeTextEditor?.document;
        return { content: doc ? doc.getText() : "" };
      }
      case "vscode.get_workspace_files": {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!root) return { files: [] };
        // Basic impl, recursive would be better
        const entries = await vscode.workspace.fs.readDirectory(root);
        return { files: entries.map(e => e[0]) };
      }
      case "vscode.apply_edit": {
        // Requires HITL approval
        const choice = await vscode.window.showInformationMessage(
          `Apply edit requested: ${args.description || 'No description'}`,
          "Approve", "Reject"
        );
        if (choice === "Approve") {
          // Implementation of workspace edit
          return { success: true };
        }
        return { success: false, reason: "User rejected" };
      }
      default:
        return { error: "Unknown tool" };
    }
  }

  public dispose() {
    this.isDisposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}
