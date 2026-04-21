import { spawn } from 'node:child_process';

/**
 * Commands that are allowed to execute.
 * Only well-known dev tools â€” no system-level access.
 */
const ALLOWLIST_PREFIXES = [
  'npm', 'npx', 'node', 'tsc', 'vitest', 'jest',
  'git', 'python', 'python3', 'pip', 'pip3', 'uv',
  'cargo', 'go', 'bun', 'deno', 'pnpm', 'yarn',
  'cat', 'echo', 'ls', 'dir', 'find', 'grep', 'rg',
  'curl', 'wget',
  'docker', 'docker-compose',
  'semgrep', 'secretlint', 'snyk',
];

/**
 * Patterns that are NEVER allowed (destructive operations).
 */
const DENYLIST_PATTERNS = [
  /rm\s+-rf/i,
  /rmdir\s+\/s/i,
  /del\s+\/[sfq]/i,
  /format\s+[a-z]:/i,
  /shutdown/i,
  /reboot/i,
  /mkfs/i,
  /dd\s+if=/i,
  /:(){ :|:& };:/,
  />\s*\/dev\/sd/i,
  /chmod\s+777/i,
  /fork\s*bomb/i,
];

const FORBIDDEN_SHELL_SYNTAX: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /[&|;<>`\r\n]/,
    reason: 'Shell metacharacters (& | ; < > ` newline) are blocked',
  },
  {
    pattern: /&&|\|\||>>|<</,
    reason: 'Command chaining/redirection operators (&& || >> <<) are blocked',
  },
  {
    pattern: /\$\(|\$\{/,
    reason: 'Command substitution syntax ($() / ${}) is blocked',
  },
  {
    pattern: /%[^%\s]+%|![^!\s]+!|\^/,
    reason: 'Windows command expansion syntax (%VAR% / !VAR! / ^) is blocked',
  },
];

const FORBIDDEN_ENCODED_EXECUTION: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bexecute_encoded\s*\(/i,
    reason: 'Encoded execution helpers are blocked',
  },
  {
    pattern:
      /\b(?:eval|Function|exec|execSync|spawn|spawnSync)\s*\([^)]*(?:Buffer\.from\([^)]*base64|atob\s*\()/i,
    reason: 'Decode-and-execute payloads are blocked',
  },
];

/**
 * Result of a terminal command execution.
 */
export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  command: string;
}

/**
 * Options for terminal execution.
 */
export interface TerminalOptions {
  /** Working directory (defaults to process.cwd()) */
  cwd?: string;
  /** Timeout in milliseconds (default: 60000, max: 300000) */
  timeout?: number;
  /** Max output characters to capture (default: 50000) */
  maxOutput?: number;
  /** Execution profile ("gate" enforces exact safe commands) */
  profile?: 'default' | 'gate';
  /** Optional exact command allowlist, used with profile=gate */
  allowedCommands?: string[];
}

const DEFAULT_TIMEOUT = 60_000;
const MAX_TIMEOUT = 300_000;
const DEFAULT_MAX_OUTPUT = 50_000;

/**
 * TerminalExecutor: Safe terminal command execution for pipeline agents.
 * Enforces allowlist/denylist, timeout, and output truncation.
 */
export class TerminalExecutor {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Execute a terminal command safely.
   * Returns result with stdout, stderr, exit code, and duration.
   */
  public async run(command: string, options: TerminalOptions = {}): Promise<CommandResult> {
    const startTime = Date.now();

    // 1. Security: Validate command
    const validationError = this.validateCommand(command, options);
    if (validationError) {
      return {
        success: false,
        stdout: '',
        stderr: `[TerminalExecutor] BLOCKED: ${validationError}`,
        exitCode: -1,
        durationMs: 0,
        command,
      };
    }

    const cwd = options.cwd ?? this.projectRoot;
    const timeout = Math.min(options.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
    const maxOutput = options.maxOutput ?? DEFAULT_MAX_OUTPUT;

    console.log(`[Terminal] Running: ${command} (cwd: ${cwd}, timeout: ${timeout}ms)`);

    return new Promise((resolve) => {
      const args = TerminalExecutor.parseCommandArgs(command);
      let exe = args.shift();

      if (!exe) {
        resolve({
          success: false,
          stdout: '',
          stderr: '[TerminalExecutor] BLOCKED: Empty after parsing',
          exitCode: -1,
          durationMs: 0,
          command,
        });
        return;
      }
      
      const isWin = process.platform === 'win32';
      let spawnExe = exe;
      let spawnArgs = args;
      let windowsVerbatimArguments = false;

      if (isWin) {
        const cmdAllowlist = ['npm', 'npx', 'tsc', 'vitest', 'jest', 'pnpm', 'yarn'];
        if (cmdAllowlist.includes(exe.toLowerCase()) && !exe.endsWith('.cmd') && !exe.endsWith('.exe')) {
          exe += '.cmd';
        }
        
        // Due to CVE-2024-27980, Node cannot spawn .cmd with shell: false.
        // We manually spawn cmd.exe with verbatim arguments, and rely on our validation checks to prevent shell injection.
        if (exe.endsWith('.cmd') || exe.endsWith('.bat')) {
          const unsafeArg = args.find((entry) => !/^[a-zA-Z0-9_./:@=,+-]+$/.test(entry));
          if (unsafeArg) {
            resolve({
              success: false,
              stdout: '',
              stderr: `[TerminalExecutor] BLOCKED: Unsafe argument for Windows command execution: ${unsafeArg}`,
              exitCode: -1,
              durationMs: Date.now() - startTime,
              command,
            });
            return;
          }
          spawnExe = process.env.ComSpec || 'cmd.exe';
          spawnArgs = ['/d', '/s', '/c', `"${escapeCmdToken(exe)} ${args.map(escapeCmdToken).join(' ')}"`];
          windowsVerbatimArguments = true;
        }
      }

      const child = spawn(spawnExe, spawnArgs, {
        cwd,
        timeout,
        shell: false, 
        windowsVerbatimArguments,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => { stdout += data.toString(); });
      child.stderr?.on('data', (data) => { stderr += data.toString(); });

      const timer = setTimeout(() => {
        stderr = `[TerminalExecutor] Execution timed out after ${timeout}ms.\n` + stderr;
        child.kill();
      }, timeout);

      child.on('error', (err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        clearTimeout(timer);
        resolve({
          success: false,
          stdout: this.truncate(stdout, maxOutput),
          stderr: this.truncate(`Spawn Error: ${errorMessage}`, maxOutput),
          exitCode: -1,
          durationMs: Date.now() - startTime,
          command,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        resolve({
          success: code === 0,
          stdout: this.truncate(stdout, maxOutput),
          stderr: this.truncate(stderr, maxOutput),
          exitCode: code ?? 1,
          durationMs,
          command,
        });
      });
    });
  }

  /**
   * Run a build command (npm run build / tsc).
   */
  public async runBuild(): Promise<CommandResult> {
    return this.run('npm run build');
  }

  /**
   * Run tests (npm test).
   */
  public async runTests(): Promise<CommandResult> {
    return this.run('npm test');
  }

  /**
   * Run typecheck (npm run typecheck / tsc --noEmit).
   */
  public async runTypecheck(): Promise<CommandResult> {
    return this.run('npm run typecheck');
  }

  /**
   * Run full verification: build + test.
   */
  public async runFullVerification(): Promise<{
    build: CommandResult;
    test: CommandResult;
    allPassed: boolean;
  }> {
    const build = await this.runBuild();
    const test = await this.runTests();

    return {
      build,
      test,
      allPassed: build.success && test.success,
    };
  }

  /**
   * Self-Healing: Analyze a failed command result to identify the cause.
   */
  public analyzeFailure(result: CommandResult): { category: string; suggestion: string } {
    const errorText = (result.stderr + "\n" + result.stdout).toLowerCase();
    
    if (errorText.includes('module not found') || errorText.includes('cannot find module')) {
      return { category: 'missing_dependency', suggestion: 'Try running npm install [module]' };
    }
    if (errorText.includes('syntaxerror') || errorText.includes('unexpected token')) {
      return { category: 'syntax_error', suggestion: 'Fix the syntax error in the reported file' };
    }
    if (errorText.includes('command timed out') || errorText.includes('timeout')) {
      return { category: 'timeout', suggestion: 'Increase timeout or optimize the command' };
    }
    if (errorText.includes('permission denied') || errorText.includes('eacces')) {
      return { category: 'permission_error', suggestion: 'Check file permissions or run with elevated privileges' };
    }
    
    return { category: 'unknown', suggestion: 'Review logs and attempt manual fix' };
  }

  /**
   * Execute with healing: Retries a command if it fails by analyzing the error.
   * Note: Actual "healing" (code fixes) should be handled by the calling agent.
   */
  public async runWithHealing(
    command: string, 
    onFailure?: (result: CommandResult, analysis: { category: string; suggestion: string }) => Promise<void>
  ): Promise<CommandResult> {
    let result = await this.run(command);
    
    if (!result.success && onFailure) {
      const analysis = this.analyzeFailure(result);
      console.log(`[Terminal] Command failed. Category: ${analysis.category}. Initiating healing...`);
      await onFailure(result, analysis);
      // Retry once after healing attempt
      result = await this.run(command);
    }
    
    return result;
  }

  // â”€â”€ Private â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Validate a command against allowlist and denylist.
   * Returns error message if blocked, null if allowed.
   */
  private validateCommand(command: string, options: TerminalOptions): string | null {
    const trimmed = command.trim();

    if (!trimmed) {
      return 'Empty command';
    }

    for (const rule of FORBIDDEN_SHELL_SYNTAX) {
      if (rule.pattern.test(trimmed)) {
        return rule.reason;
      }
    }

    for (const rule of FORBIDDEN_ENCODED_EXECUTION) {
      if (rule.pattern.test(trimmed)) {
        return rule.reason;
      }
    }

    if (options.profile === 'gate') {
      const allowed = options.allowedCommands ?? [];
      if (!allowed.includes(trimmed)) {
        return `Command "${trimmed}" is not allowed in gate profile`;
      }
    }

    // 1. Security: Block access to config directories entirely in arguments
    const configDirs = [
      '.config/opencode',
      '.config/agent',
      'Alloy-accounts.json',
      'google-gemini-tokens.json',
      '.ai-company/state.json'
    ];
    
    for (const dir of configDirs) {
      if (trimmed.toLowerCase().includes(dir.toLowerCase())) {
        return `Access to sensitive config path/file "${dir}" is blocked in terminal commands.`;
      }
    }

    // Check denylist first (highest priority)
    for (const pattern of DENYLIST_PATTERNS) {
      if (pattern.test(trimmed)) {
        return `Command matches deny pattern: ${pattern.source}`;
      }
    }

    const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';
    const isAllowed = ALLOWLIST_PREFIXES.some(
      (prefix) => firstWord === prefix || firstWord.endsWith(`/${prefix}`) || firstWord.endsWith(`\\${prefix}`),
    );

    if (!isAllowed) {
      return `Command "${firstWord}" not in allowlist. Allowed: ${ALLOWLIST_PREFIXES.join(', ')}`;
    }

    return null;
  }

  /**
   * Truncate output to max characters.
   */
  private truncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.substring(0, maxChars) + `\n\n... [truncated at ${maxChars} chars]`;
  }

  /**
   * Parse command string into arguments, respecting single and double quotes.
   * Does NOT use shell â€” prevents injection.
   */
  public static parseCommandArgs(command: string): string[] {
    const args: string[] = [];
    let current = '';
    let inDouble = false;
    let inSingle = false;
    let escape = false;

    for (let i = 0; i < command.length; i++) {
      const ch = command[i]!;

      if (escape) {
        current += ch;
        escape = false;
        continue;
      }

      if (ch === '\\' && !inSingle) {
        escape = true;
        continue;
      }

      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        continue;
      }

      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        continue;
      }

      if (ch === ' ' && !inDouble && !inSingle) {
        if (current.length > 0) {
          args.push(current);
          current = '';
        }
        continue;
      }

      current += ch;
    }

    if (current.length > 0) {
      args.push(current);
    }

    return args;
  }
}

function escapeCmdToken(token: string): string {
  return token.replace(/(["^&|<>!%])/g, '^$1');
}
