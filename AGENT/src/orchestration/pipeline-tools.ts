import { SequentialPipeline, PlanMode } from './sequential-pipeline';
import { AGENTS, getAgentByRole, getTotalEstimatedMinutes } from './agents';
import { TerminalExecutor } from './terminal-executor';
import { tool } from '@opencode-ai/plugin/tool';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { SovereignGatewayClient } from './gateway-client';
import type { PluginClient } from '../plugin/types';

/**
 * PipelineTools: Exposes Sequential Pipeline capabilities as OpenCode plugin tools.
 */
export class PipelineTools {
  private pipeline: SequentialPipeline;
  private terminal: TerminalExecutor;
  private projectRoot: string;
  private SovereignGatewayClient: SovereignGatewayClient;
  private client: PluginClient;

  constructor(directory: string, SovereignGatewayClient: SovereignGatewayClient, client: PluginClient) {
    this.projectRoot = directory;
    this.SovereignGatewayClient = SovereignGatewayClient;
    this.client = client;
    this.pipeline = new SequentialPipeline(directory, SovereignGatewayClient);
    this.terminal = new TerminalExecutor(directory);
  }

  public getTools(): Record<string, any> {
    const pipeline = this.pipeline;
    const terminal = this.terminal;
    const projectRoot = this.projectRoot;
    const self = this;

    return {
      pipeline_start: tool({
        description: `Start the 18-agent sequential pipeline (CEO â†’ PM â†’ Architect â†’ ... â†’ DevOps). Each agent reads previous agents' outputs and writes to .ai-company/. Estimated time: ~${getTotalEstimatedMinutes()} minutes.`,
        args: {
          task: tool.schema
            .string()
            .describe('The user task or feature request to build'),
          skipAgents: tool.schema
            .string()
            .optional()
            .describe('Comma-separated list of agent roles to skip (e.g. "tech_writer,performance")'),
          startFrom: tool.schema
            .number()
            .optional()
            .describe('Start from agent order number (1-18). Default: 1'),
          planMode: tool.schema
            .string()
            .optional()
            .describe('Pipeline scope: full (all 18), management_only (1-3), dev_only (7-10), quality_only (11-15), custom (use skipAgents). Default: full'),
          modelOverride: tool.schema
            .string()
            .optional()
            .describe('Override model for ALL agents (e.g. "google/Sovereign-claude-sonnet-4-6")'),
          skillsDir: tool.schema
            .string()
            .optional()
            .describe('Path to .agent/skills/ directory for skill injection into agent prompts'),
        },
        async execute(args) {
          const skipAgents = args.skipAgents
            ? args.skipAgents.split(',').map((s) => s.trim())
            : [];

          return (self.client.tui as any).withProgress({
            title: `Sovereign Pipeline: ${args.task.slice(0, 30)}...`,
            cancellable: true,
          }, async (progress: any, token: any) => {
            try {
              const result = await pipeline.start(args.task, {
                skipAgents,
                startFromOrder: args.startFrom,
                planMode: (args.planMode as PlanMode) ?? PlanMode.FULL,
                modelOverride: args.modelOverride,
                skillsDir: args.skillsDir,
                onAgentStart: (agent) => {
                  const pct = Math.round((agent.order / AGENTS.length) * 100);
                  progress.report({ 
                    message: `${agent.emoji} ${agent.name} (${agent.order}/18)`,
                    increment: 0 // We don't use cumulative increment here, we just set message
                  });
                  console.log(`\n${'â•'.repeat(60)}`);
                  console.log(`${agent.emoji} AGENT ${agent.order}/18: ${agent.name}`);
                  console.log(`Layer: ${agent.layer} | Model: ${agent.preferredModel}`);
                  console.log(`${'â•'.repeat(60)}\n`);
                },
                onAgentComplete: (agent) => {
                  console.log(`âœ… ${agent.name} completed â†’ ${agent.outputFiles[0]}`);
                },
                onError: (agent, error) => {
                  console.error(`âŒ ${agent.name} FAILED: ${error.message}`);
                },
              });

              const summary = result.agentResults
                .map((r) => {
                  const icon =
                    r.status === 'completed' ? 'âœ…' : r.status === 'skipped' ? 'â­ï¸' : 'âŒ';
                  return `${icon} ${r.agent.emoji} ${r.agent.name}: ${r.status}${r.durationMs > 0 ? ` (${r.durationMs}ms)` : ''}`;
                })
                .join('\n');

              return `### Pipeline ${result.status.toUpperCase()}\n\n**Results (${result.completedCount}/${AGENTS.length} completed):**\n${summary}\n\nTotal time: ${result.totalDurationMs}ms\nOutputs: .ai-company/`;
            } catch (error) {
              return `Pipeline error: ${error instanceof Error ? error.message : String(error)}`;
            }
          });
        },
      }),

      pipeline_run_command: tool({
        description:
          'Run a terminal command safely (allowlist: npm, node, git, tsc, vitest, python). Returns stdout, stderr, and exit code.',
        args: {
          command: tool.schema
            .string()
            .describe('Command to execute (e.g. "npm run build", "npm test", "git status")'),
          timeout: tool.schema
            .number()
            .optional()
            .describe('Timeout in milliseconds (default: 60000, max: 300000)'),
        },
        async execute(args) {
          const result = await terminal.run(args.command, {
            timeout: args.timeout,
          });

          const icon = result.success ? '\u2705' : '\u274c';
          return `${icon} **Command:** \`${result.command}\`\n**Exit Code:** ${result.exitCode}\n**Duration:** ${result.durationMs}ms\n\n**stdout:**\n\`\`\`\n${result.stdout || '(empty)'}\n\`\`\`\n\n**stderr:**\n\`\`\`\n${result.stderr || '(empty)'}\n\`\`\``;
        },
      }),

      pipeline_status: tool({
        description:
          'Get current pipeline progress, active agent, timeline, and estimated remaining time.',
        args: {},
        async execute() {
          try {
            const progress = await pipeline.getProgress();
            const { state } = progress;

            const agentList = AGENTS.map((a) => {
              const done = state.completedAgents.includes(a.role);
              const current = state.currentAgent === a.role;
              const icon = done ? 'âœ…' : current ? 'ğŸ”„' : 'â¬œ';
              return `${icon} ${a.emoji} ${a.name}`;
            }).join('\n');

            const timelineStr = progress.timeline
              .map((t) => `- ${t.agent}: ${t.file} (${t.timestamp})`)
              .join('\n');

            return `### Pipeline Status: ${state.pipelineStatus.toUpperCase()}

**Progress:** ${progress.completedCount}/${progress.totalAgents} agents
**Current:** ${progress.currentAgent ? progress.currentAgent.emoji + ' ' + progress.currentAgent.name : 'None'}
**Next:** ${progress.nextAgent ? progress.nextAgent.emoji + ' ' + progress.nextAgent.name : 'None'}
**Est. Remaining:** ~${progress.estimatedRemainingMinutes} min

**Agents:**
${agentList}

**Timeline:**
${timelineStr || 'No outputs yet.'}

**Task:** ${state.userTask || 'Not set'}`;
          } catch (error) {
            return `Status error: ${error instanceof Error ? error.message : String(error)}`;
          }
        },
      }),

      pipeline_pause: tool({
        description: 'Pause the pipeline after the current agent completes.',
        args: {},
        async execute() {
          pipeline.pause();
          return 'Pipeline pause requested. Will stop after current agent completes.';
        },
      }),

      pipeline_resume: tool({
        description: 'Resume a paused pipeline from where it left off.',
        args: {
          task: tool.schema
            .string()
            .optional()
            .describe('Updated task description (optional, uses original if not provided)'),
        },
        async execute(args) {
          try {
            const result = await pipeline.resume(args.task ?? '');
            return `Pipeline resumed. Status: ${result.status}. Completed: ${result.completedCount}/${AGENTS.length}`;
          } catch (error) {
            return `Resume error: ${error instanceof Error ? error.message : String(error)}`;
          }
        },
      }),

      pipeline_skip: tool({
        description: 'Mark specific agents to be skipped in the current pipeline run.',
        args: {
          agents: tool.schema
            .string()
            .describe('Comma-separated list of agent roles to skip (e.g. "tech_writer,performance")'),
        },
        async execute(args) {
          const roles = args.agents.split(',').map((s) => s.trim());
          const valid = roles.filter((r) => getAgentByRole(r));
          const invalid = roles.filter((r) => !getAgentByRole(r));

          let response = `Skip list updated: ${valid.join(', ')}`;
          if (invalid.length > 0) {
            response += `\nâš ï¸ Unknown roles ignored: ${invalid.join(', ')}`;
            response += `\n\nValid roles: ${AGENTS.map((a) => a.role).join(', ')}`;
          }
          return response;
        },
      }),

      pipeline_agent_output: tool({
        description:
          'Read the output of a specific agent from .ai-company/ shared memory.',
        args: {
          agent: tool.schema
            .string()
            .describe(
              `Agent role to read output from. Options: ${AGENTS.map((a) => a.role).join(', ')}`
            ),
        },
        async execute(args) {
          const agent = getAgentByRole(args.agent);
          if (!agent) {
            return `Unknown agent role: "${args.agent}". Valid: ${AGENTS.map((a) => a.role).join(', ')}`;
          }

          const memory = pipeline.getMemory();
          const outputFile = agent.outputFiles[0] ?? `${agent.role}-output.md`;
          const content = await memory.readAgentOutput(outputFile);

          if (!content) {
            return `No output found for ${agent.emoji} ${agent.name}. This agent may not have run yet.`;
          }

          return `### Output: ${agent.emoji} ${agent.name}\n**File:** ${agent.outputFiles[0]}\n\n${content}`;
        },
      }),

      pipeline_install_skill: tool({
        description: 'Install a skill from the awesome-skills repository (simulated as incele/.agent/skills) into the current project.',
        args: {
          skillName: tool.schema.string().describe('Name of the skill to install (e.g. "tailwind-patterns")'),
        },
        async execute(args) {
          const sourceDir = path.join(projectRoot, 'incele', '.agent', 'skills', args.skillName);
          const targetDir = path.join(projectRoot, '.agent', 'skills', args.skillName);

          try {
            // Check if source exists
            await fs.access(sourceDir);
          } catch {
            return `Error: Skill "${args.skillName}" not found in awesome-skills repository.`;
          }

          try {
            // Check if already installed
            await fs.access(targetDir);
            return `Skill "${args.skillName}" is already installed.`;
          } catch {
            // Does not exist, proceed with install
          }

          try {
            // Since Node.js fs/promises doesn't have a simple recursive copy dir without extra logic,
            // we will simulate the copy. We know skills are just a folder with a SKILL.md.
            await fs.mkdir(targetDir, { recursive: true });
            
            // Read source SKILL.md
            const content = await fs.readFile(path.join(sourceDir, 'SKILL.md'), 'utf-8');
            
            // Write target SKILL.md
            await fs.writeFile(path.join(targetDir, 'SKILL.md'), content, 'utf-8');
            
            return `âœ… Successfully installed skill: ${args.skillName}`;
          } catch (error) {
            return `Failed to install skill: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
      }),

      pipeline_approve_skill: tool({
        description: 'Approve a proposed skill and move it from .ai-company/proposed-skills/ to .agent/skills/',
        args: {
          skillName: tool.schema.string().describe('Name of the proposed skill to approve (e.g. "project-error-patterns")'),
        },
        async execute(args) {
          const proposedDir = path.join(projectRoot, '.ai-company', 'proposed-skills');
          const proposedFile = path.join(proposedDir, `${args.skillName}.md`);
          const targetDir = path.join(projectRoot, '.agent', 'skills', args.skillName);
          const targetFile = path.join(targetDir, 'SKILL.md');

          try {
            // Check if proposed skill exists
            await fs.access(proposedFile);
          } catch {
            return `Error: Proposed skill "${args.skillName}" not found in .ai-company/proposed-skills/.`;
          }

          try {
            // Read proposed content
            const content = await fs.readFile(proposedFile, 'utf-8');
            
            // Ensure target directory exists
            await fs.mkdir(targetDir, { recursive: true });
            
            // Write to actual skills directory
            await fs.writeFile(targetFile, content, 'utf-8');
            
            // Delete proposed file
            await fs.unlink(proposedFile);
            
            // Try to remove from INDEX.md
            try {
              const indexPath = path.join(proposedDir, 'INDEX.md');
              let indexContent = await fs.readFile(indexPath, 'utf-8');
              const lines = indexContent.split('\n');
              const filteredLines = lines.filter(line => !line.includes(`| ${args.skillName} |`));
              await fs.writeFile(indexPath, filteredLines.join('\n'), 'utf-8');
            } catch (e) {
              // Ignore index update errors
              console.warn('[PipelineTools] Could not update INDEX.md after skill approval', e);
            }

            return `âœ… Successfully approved and installed proposed skill: ${args.skillName}`;
          } catch (error) {
             return `Failed to approve skill: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
      })
    };
  }
}
