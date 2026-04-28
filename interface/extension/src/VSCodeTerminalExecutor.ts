import * as vscode from 'vscode';
import { TerminalExecutor, CommandResult, TerminalOptions } from '../../../core/gateway/src/orchestration/terminal-executor';

export class VSCodeTerminalExecutor extends TerminalExecutor {
	constructor(projectRoot: string) {
		super(projectRoot);
	}

	public async run(command: string, options: TerminalOptions = {}): Promise<CommandResult> {
		// We still use the parent's validation logic for security
		// but we'll use VS Code's terminal for execution visibility if possible
		// or use the standard Node runner but notify VS Code

		// For now, we'll use the parent's run method (which uses node:child_process)
		// but we could also use vscode.tasks or a dedicated terminal.
		// To keep it simple and capture stdout/stderr reliably for the agent, 
		// we stay with the Node implementation but add VS Code status notifications.
		
		return vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Alloy AI: Running ${command}`,
			cancellable: false
		}, async () => {
			return super.run(command, options);
		});
	}
}
