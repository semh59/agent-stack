import type { PipelineState } from '../shared-memory';
import type { AlloyGatewayClient } from '../gateway-client';

export interface SlashCommandContext {
  projectRoot: string;
  sessionId: string;
  state: PipelineState;
  updateState: (partial: Partial<PipelineState>) => Promise<void>;
  client?: AlloyGatewayClient;
}

export interface SlashCommandResult {
  success: boolean;
  message: string;
  artifacts?: Record<string, string>;
  suggestedState?: AutonomyState;
}

export type AutonomyState =
  | 'queued' | 'init' | 'plan' | 'execute' | 'verify' | 'reflect' | 'paused' | 'retry' | 'done' | 'failed' | 'stopped';

export interface ISlashCommand {
  name: string;
  description: string;
  execute(args: string[], context: SlashCommandContext): Promise<SlashCommandResult>;
}

export class SlashCommandRegistry {
  private readonly commands = new Map<string, ISlashCommand>();

  public register(command: ISlashCommand): void {
    this.commands.set(command.name.toLowerCase(), command);
  }

  public getCommand(name: string): ISlashCommand | undefined {
    return this.commands.get(name.toLowerCase());
  }

  public listCommands(): ISlashCommand[] {
    return Array.from(this.commands.values());
  }

  public async execute(rawInput: string, context: SlashCommandContext): Promise<SlashCommandResult> {
    const parts = rawInput.trim().split(/\s+/);
    const commandName = parts[0]?.replace(/^\//, '').toLowerCase();
    const args = parts.slice(1);

    if (!commandName) {
      return { success: false, message: 'No command provided.' };
    }

    const command = this.getCommand(commandName);
    if (!command) {
      return { success: false, message: `Unknown command: /${commandName}` };
    }

    try {
      return await command.execute(args, context);
    } catch (err) {
      return { 
        success: false, 
        message: `Error executing /${commandName}: ${err instanceof Error ? err.message : String(err)}` 
      };
    }
  }
}
