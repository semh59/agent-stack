import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import type { IToolExecutionEngine, ToolResult, ApprovalRequest } from '../../src/orchestration/tool-execution-engine';

/**
 * ToolExecutionEngine: The "Binary Bridge" of Alloy AI.
 * Hardened with realpath protection and ID-mapped HITL.
 * Implements the shared IToolExecutionEngine interface to allow 
 * the orchestration layer to run within VSCode.
 */
export class ToolExecutionEngine implements IToolExecutionEngine {
	private onApprovalRequired?: (request: ApprovalRequest) => Promise<boolean>;

	constructor(private readonly projectRoot: string) { }

	public setApprovalHandler(handler: (request: ApprovalRequest) => Promise<boolean>) {
		this.onApprovalRequired = handler;
	}

	/**
	 * Request approval for an action with ID mapping.
	 */
	public async requestApproval(action: string): Promise<boolean> {
		if (this.onApprovalRequired) {
			const id = crypto.randomUUID();
			return await this.onApprovalRequired({ id, action });
		}
		return true;
	}

	/**
	 * Read file content safely.
	 */
	public async readFile(filePath: string): Promise<ToolResult> {
		try {
			const absolutePath = await this.resolvePath(filePath);
			const content = await fs.readFile(absolutePath, 'utf-8');
			return { success: true, output: content };
		} catch (err: any) {
			return { success: false, output: `Error reading file: ${err.message}` };
		}
	}

	/**
	 * Write file content safely with automatic directory creation.
	 */
	public async writeFile(filePath: string, content: string): Promise<ToolResult> {
		try {
			if (!(await this.requestApproval(`Write file: ${filePath}`))) {
				return { success: false, output: 'Action rejected by user.' };
			}
			const absolutePath = await this.resolvePath(filePath);
			const dir = path.dirname(absolutePath);
			await fs.mkdir(dir, { recursive: true });
			await fs.writeFile(absolutePath, content, 'utf-8');
			return { success: true, output: `File written successfully: ${filePath}` };
		} catch (err: any) {
			return { success: false, output: `Error writing file: ${err.message}` };
		}
	}

	/**
	 * List directory contents.
	 */
	public async listFiles(dirPath: string): Promise<ToolResult> {
		try {
			const absolutePath = await this.resolvePath(dirPath);
			const entries = await fs.readdir(absolutePath, { withFileTypes: true });
			const output = entries
				.map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`)
				.join('\n');
			return { success: true, output };
		} catch (err: any) {
			return { success: false, output: `Error listing files: ${err.message}` };
		}
	}

	/**
	 * Resolve path and check for trait traversal with realpath.
	 */
	private async resolvePath(relativePath: string): Promise<string> {
		const rootReal = await fs.realpath(this.projectRoot);
		const targetPath = path.resolve(this.projectRoot, relativePath);
		
		let targetReal: string | null = null;
		try {
			targetReal = await fs.realpath(targetPath);
		} catch {
			// File doesn't exist yet, check its parent recursively
			let current = targetPath;
			while (current !== path.dirname(current)) { // Until drive root
				const parent = path.dirname(current);
				try {
					const parentReal = await fs.realpath(parent);
					const isInside = parentReal.startsWith(rootReal + path.sep) || parentReal === rootReal;
					if (!isInside) {
						throw new Error(`SECURITY_BLOCK: Path "${relativePath}" resolves outside the workspace`);
					}
					// Parent is inside, so this path is safe to attempt (it just doesn't exist yet)
					return targetPath;
				} catch {
					current = parent;
				}
			}
			// Reached drive root and it's not the workspace
			throw new Error(`SECURITY_BLOCK: Path "${relativePath}" resolves outside the workspace`);
		}

		const isInside = targetReal.startsWith(rootReal + path.sep) || targetReal === rootReal;
		if (!isInside) {
			throw new Error(`SECURITY_BLOCK: Path traversal attempt detected for "${relativePath}"`);
		}
		return targetReal;
	}
}
