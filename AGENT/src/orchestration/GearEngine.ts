import type { 
  AutonomySession, 
  AutonomyState,
  TaskNode 
} from "./autonomy-types";
import { SkillEngine } from "./SkillEngine";

export type GearLevel = "fast" | "standard" | "elite";

export interface GearContext {
  session: AutonomySession;
  activeTask: TaskNode;
  phase: AutonomyState;
  gearLevel: GearLevel;
}

/**
 * GearEngine: Manages "gears" (intensity levels) for autonomous loops.
 * 
 * Responsibilities:
 * - Dynamic prompt construction based on Phase and GearLevel.
 * - History squeezing (summarizing long logs to fit context windows).
 * - Adapting instructions for different model capabilities.
 */
export class GearEngine {
  private skillEngine?: SkillEngine;

  /**
   * Scales the gear level up or down based on current context.
   * fast <-> standard <-> elite
   */
  public scaleGear(current: GearLevel, direction: "up" | "down"): GearLevel {
    const levels: GearLevel[] = ["fast", "standard", "elite"];
    const index = levels.indexOf(current);
    if (direction === "up") {
      return levels[Math.min(index + 1, levels.length - 1)]!;
    } else {
      return levels[Math.max(index - 1, 0)]!;
    }
  }


  /**
   * Sets the skill engine for context-aware prompt building.
   */
  public setSkillEngine(skillEngine: SkillEngine): void {
    this.skillEngine = skillEngine;
  }
  /**
   * Constructs the main system prompt for a mission cycle.
   */
  public buildSystemPrompt(context: GearContext): string {
    const { session, activeTask, phase, gearLevel } = context;
    
    const baseIntelligence = gearLevel === "elite" 
      ? "You are an Elite Autonomous Agent. Precision and architectural integrity are your primary goals."
      : "You are an efficient coding agent focused on solving the task accurately.";

    const phaseInstructions = this.getPhaseInstructions(phase);
    
    return [
      baseIntelligence,
      `Current Mission Objective: ${session.objective}`,
      `Current Phase: ${phase.toUpperCase()}`,
      `Active Task: ${activeTask.type} (${activeTask.id})`,
      "",
      "CRITICAL INSTRUCTIONS:",
      phaseInstructions,
      "",
      this.buildSkillsPrompt(activeTask.type, session.objective),
      "",
      "CONTEXT RULES:",
      "- Always respect ARCHITECTURE.md (if present).",
      "- Use a step-by-step approach.",
      gearLevel === "elite" ? "- Self-reflect before finalizing every code change." : "- Focus on speed and correctness."
    ].join("\n");
  }

  /**
   * Summarizes session history to prevent context window overflow.
   * "Squeezes" the operation log into a concise tactical summary.
   */
  public squeezeHistory(session: AutonomySession): string {
    const log = session.opLog;
    if (log.length === 0) return "No prior history in this mission.";

    const RECENT_COUNT = 5;

    if (log.length <= RECENT_COUNT) {
      // All entries fit; show them all
      return `Mission History:\n${log.map(l => `[Cycle ${l.cycle}] ${l.taskType}: ${l.status} - ${l.summary}`).join("\n")}`;
    }

    // Summarize early cycles
    const earlyLogs = log.slice(0, -RECENT_COUNT);
    const earlySummary = `Cycles 1-${earlyLogs.length}: ${earlyLogs.filter(l => l.status === "completed").length} completed, ${earlyLogs.filter(l => l.status === "failed").length} failed`;

    // Detail recent cycles
    const recentLogs = log.slice(-RECENT_COUNT);
    const recentDetail = recentLogs.map(l => 
      `[Cycle ${l.cycle}] ${l.taskType}: ${l.status} - ${l.summary}`
    ).join("\n");

    return `Mission History:\n${earlySummary}\n---\n${recentDetail}`;
  }

  /**
   * Returns specific instructions based on the current autonomy phase.
   */
  private getPhaseInstructions(phase: AutonomyState): string {
    switch (phase) {
      case "plan":
        return "Analyze the codebase and provide a detailed implementation plan. Do not write code yet.";
      case "execute":
        return "Implement the approved plan. Focus on writing clean, production-ready code.";
      case "verify":
        return "Validate your changes. Run tests and check for lint errors or architectural violations.";
      case "retry":
        return "The previous attempt failed or was rejected by the gate. Analyze the failure and provide a fix.";
      default:
        return "Proceed with the mission objective logically.";
    }
  }

  /**
   * Fetches and formats relevant skills for the prompt.
   */
  private buildSkillsPrompt(taskType: string, objectives: string): string {
    if (!this.skillEngine) return "";
    
    const skills = this.skillEngine.findRelevantSkills(taskType, objectives);
    if (skills.length === 0) return "";

    return [
      "RELEVANT SKILLS & BEST PRACTICES:",
      ...skills.map(s => `### ${s.name}\n${s.description}\n${s.content.replace(/---[\s\S]*?---/, "").trim()}`),
      ""
    ].join("\n");
  }
}

export const gearEngine = new GearEngine();
