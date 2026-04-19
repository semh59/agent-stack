import * as vscode from 'vscode';
import * as path from 'path';
import { SharedMemory } from '../../src/orchestration/shared-memory';

export class VSCodeSharedMemory extends SharedMemory {
	constructor(projectRoot: string) {
		super(projectRoot);
	}

	// We can override methods here if we want to use vscode.workspace.fs
	// For now, SharedMemory's node:fs/promises implementation is robust.
	// We might add VS Code events when files are written.

	public async writeAgentOutput(agentName: string, fileName: string, content: string): Promise<string[]> {
		const files = await super.writeAgentOutput(agentName, fileName, content);
		
		// Auto-open the important output file in VS Code
		if (files.length > 0) {
			const projectRoot = path.join(this.rootDir, '..');
			const filePath = path.join(projectRoot, fileName);
			
			try {
				const uri = vscode.Uri.file(filePath);
				vscode.workspace.openTextDocument(uri).then(doc => {
					vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
				});
			} catch (err) {
				console.error('Failed to open generated file:', err);
			}
		}
		
		return files;
	}
}
