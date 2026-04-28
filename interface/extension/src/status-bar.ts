import * as vscode from 'vscode';

export class StatusBarManager {
  private readonly item: vscode.StatusBarItem;

  constructor(context: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.command = 'alloy.startPipeline';
    this.item.tooltip = 'Alloy AI — Mission Control';
    this.item.show();
    context.subscriptions.push(this.item);
  }

  setConnected(version?: string): void {
    this.item.text = `$(check) Alloy${version ? ` v${version}` : ''}`;
    this.item.color = undefined;
    this.item.backgroundColor = undefined;
  }

  setDisconnected(): void {
    this.item.text = '$(warning) Alloy (disconnected)';
    this.item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    this.item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground',
    );
  }

  setWorking(label = 'Working…'): void {
    this.item.text = `$(loading~spin) Alloy — ${label}`;
    this.item.color = undefined;
    this.item.backgroundColor = undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}
