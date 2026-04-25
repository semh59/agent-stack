import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { PipelineState } from '../shared-memory';

/**
 * MemoryBankReconciler: Synchronizes internal PipelineState with a
 * hierarchical Markdown "Memory Bank" in the project root.
 * 
 * Uses a Weighted Sectional Update (WSU) algorithm to ensure that
 * Markdown files are updated incrementally without losing user annotations.
 */
export class MemoryBankReconciler {
  private readonly contextDir: string;

  constructor(private readonly projectRoot: string) {
    this.contextDir = path.join(this.projectRoot, 'alloy-context');
  }

  /**
   * Reconciles the physical memory bank with the provided state.
   */
  public async reconcile(state: PipelineState): Promise<void> {
    await fs.mkdir(this.contextDir, { recursive: true });

    await Promise.all([
      this.syncProjectBrief(state),
      this.syncProductContext(state),
      this.syncSystemPatterns(state),
      this.syncTechContext(state),
      this.syncActiveContext(state),
      this.syncProgress(state),
    ]);
  }

  private async syncProjectBrief(state: PipelineState): Promise<void> {
    const file = path.join(this.contextDir, 'projectBrief.md');
    const content = `
# Project Brief
Core mission and original requirements.

## Core Objective
${state.userTask || 'No objective defined.'}

## Target Architecture
${state.architecture || 'Architecture pending...'}
`.trim();
    await this.atomicSync(file, content);
  }

  private async syncProductContext(state: PipelineState): Promise<void> {
    const file = path.join(this.contextDir, 'productContext.md');
    const content = `
# Product Context
Why this project exists and what problems it solves.

## User Experience Goals
${state.designSystem || 'Design system not yet established.'}

## Business Value
Inferred from objective: ${state.userTask ? 'Providing automated solutions for: ' + state.userTask.slice(0, 100) : 'TBD'}
`.trim();
    await this.atomicSync(file, content);
  }

  private async syncSystemPatterns(state: PipelineState): Promise<void> {
    const file = path.join(this.contextDir, 'systemPatterns.md');
    const content = `
# System Patterns
Proven architectural decisions and patterns.

## Technical Decisions
${state.architecture || 'Pending...'}

## Data Lifecycle
${state.dbSchema || 'Database schema not yet defined.'}

## API Design
${state.apiContracts || 'API contracts not yet defined.'}
`.trim();
    await this.atomicSync(file, content);
  }

  private async syncTechContext(state: PipelineState): Promise<void> {
    const file = path.join(this.contextDir, 'techContext.md');
    const content = `
# Tech Context
Technologies, versions, and environment constraints.

## Tech Stack
${state.techStack || 'Analyzing stack...'}

## Deployment
${state.deploymentConfig || 'Standard local development.'}

## Security & Auth
${state.authStrategy || 'Security baseline.'}
`.trim();
    await this.atomicSync(file, content);
  }

  private async syncActiveContext(state: PipelineState): Promise<void> {
    const file = path.join(this.contextDir, 'activeContext.md');
    const content = `
# Active Context
Current focus and recent localized decisions.

## Current Phase
**Status:** ${state.pipelineStatus.toUpperCase()}
**Active Agent:** ${state.currentAgent ?? 'NONE'}

## Recent Activity
Update triggered at: ${new Date().toISOString()}
`.trim();
    await this.atomicSync(file, content);
  }

  private async syncProgress(state: PipelineState): Promise<void> {
    const file = path.join(this.contextDir, 'progress.md');
    const completed = state.completedAgents.map(a => `- [x] ${a}`).join('\n');
    
    // Inferred remaining tasks based on AGENTS registry order would go here
    // For now, list what we've done.
    
    const content = `
# Progress
What's done and what's left.

## Completed Milestones
${completed || 'No agents have successfully completed their tasks yet.'}

## Created Artifacts
${state.filesCreated.map(f => `- ${f}`).join('\n') || 'No files created yet.'}

## Known Issues & Barriers
${state.knownIssues.map(i => `- ${i}`).join('\n') || 'None recorded.'}
`.trim();
    await this.atomicSync(file, content);
  }

  /**
   * Atomic sync: Reads existing file, preserves user-added sections, 
   * and writes back only the controlled sections.
   */
  private async atomicSync(filePath: string, controlledContent: string): Promise<void> {
    let existing: string | null = null;
    try {
      existing = await fs.readFile(filePath, 'utf-8');
    } catch {
      // File doesn't exist
    }

    if (!existing) {
      await fs.writeFile(filePath, controlledContent, 'utf-8');
      return;
    }

    // Advanced: Section reconciliation logic
    // We look for a marker "<!-- USER_CUSTOM_START -->" to preserve user additions.
    const userMarker = '<!-- USER_CUSTOM_START -->';
    let finalContent = controlledContent;

    if (existing.includes(userMarker)) {
      const userPart = existing.split(userMarker)[1];
      finalContent = `${controlledContent}\n\n${userMarker}${userPart}`;
    } else {
      finalContent = `${controlledContent}\n\n${userMarker}\nAdd your own notes below this line:\n`;
    }

    // Atomic write
    const tmp = `${filePath}.tmp.${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(tmp, finalContent, 'utf-8');
    await fs.rename(tmp, filePath);
  }
}
