import * as vscode from 'vscode';
import { ChatViewProvider } from './ChatViewProvider';
import { runStartupRecoveryFlow } from './recovery';
import { BridgeManager } from './BridgeManager';
import { MCPToolBridge } from './MCPToolBridge';
import { WorkspaceIndexer } from './WorkspaceIndexer';

let bridgeManager: BridgeManager | null = null;
let mcpToolBridge: MCPToolBridge | null = null;
let workspaceIndexer: WorkspaceIndexer | null = null;

export function activate(context: vscode.ExtensionContext) {
	console.log('Alloy AI is now active');
	const config = vscode.workspace.getConfiguration("alloy");
	const gatewayAuthToken = process.env.ALLOY_GATEWAY_TOKEN
		?? config.get<string>("gatewayAuthToken")
		?? null;

	try {
		const provider = new ChatViewProvider(context.extensionUri, context.globalStorageUri.fsPath);
		console.log('ChatViewProvider created');

		const disposable = vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider);
		context.subscriptions.push(disposable);
		context.subscriptions.push(provider);
		console.log('WebviewViewProvider registered for viewType:', ChatViewProvider.viewType);
	} catch (err: unknown) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		console.error('Failed to register WebviewViewProvider:', err);
		vscode.window.showErrorMessage(`Alloy AI failed to initialize: ${errorMessage}`);
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('alloy.startPipeline', () => {
			vscode.window.showInformationMessage('Starting Alloy AI Pipeline...');
		})
	);

	// Start Bridge Manager
	bridgeManager = new BridgeManager(context);
	mcpToolBridge = new MCPToolBridge(51122);
	mcpToolBridge.connect();
	
	// Start RAG Indexer
	workspaceIndexer = new WorkspaceIndexer(9100);

	void runStartupRecoveryFlow(gatewayAuthToken, bridgeManager);
}

export function deactivate() {
	if (bridgeManager) {
		bridgeManager.dispose();
		bridgeManager = null;
	}
	if (mcpToolBridge) {
		mcpToolBridge.dispose();
		mcpToolBridge = null;
	}
	if (workspaceIndexer) {
		workspaceIndexer.dispose();
		workspaceIndexer = null;
	}
}
