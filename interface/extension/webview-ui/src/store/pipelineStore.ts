/* ═══════════════════════════════════════════════════════════════════
   Pipeline Store — Zustand state for pipeline & mission tracking
   ═══════════════════════════════════════════════════════════════════ */

import { create } from "zustand";
import type {
  PipelineStatusPayload,
  PipelinePhasePayload,
  MissionSnapshotPayload,
  MissionEventPayload,
  MissionPhase,
} from "@/lib/vscode";

interface PipelineState {
  // Pipeline
  pipelineStatus: PipelineStatusPayload | null;
  phases: MissionPhase[];
  isPipelineRunning: boolean;

  // Mission
  activeMission: MissionSnapshotPayload | null;
  missionEvents: MissionEventPayload[];

  // Stats
  stats: {
    projects: { total: number; completedThisMonth: number };
    skills: { active: number; total: number };
    accounts: { total: number; active: number };
    tokenUsage: { today: number; thisWeek: number; thisMonth: number };
    pipelineRuns: { total: number; successRate: number };
  } | null;

  // Actions
  setPipelineStatus: (status: PipelineStatusPayload) => void;
  updatePhase: (phase: PipelinePhasePayload) => void;
  setMissionSnapshot: (snapshot: MissionSnapshotPayload) => void;
  addMissionEvent: (event: MissionEventPayload) => void;
  setStats: (stats: NonNullable<PipelineState["stats"]>) => void;
  resetPipeline: () => void;
}

export const usePipelineStore = create<PipelineState>((set) => ({
  pipelineStatus: null,
  phases: [],
  isPipelineRunning: false,
  activeMission: null,
  missionEvents: [],
  stats: null,

  setPipelineStatus: (status) =>
    set({
      pipelineStatus: status,
      isPipelineRunning: status.status.status === "running" || status.status.status === "active",
    }),

  updatePhase: (phase) =>
    set((state) => {
      const existing = state.phases.findIndex((p) => p.name === phase.phase);
      const newPhase: MissionPhase = {
        name: phase.phase,
        status: phase.status === "started" ? "running" :
                phase.status === "completed" ? "completed" :
                phase.status === "failed" ? "failed" : "pending",
        progress: phase.progress,
        message: phase.message,
        startedAt: phase.status === "started" ? new Date().toISOString() : undefined,
        completedAt: phase.status === "completed" ? new Date().toISOString() : undefined,
      };

      const phases = [...state.phases];
      if (existing >= 0) {
        phases[existing] = { ...phases[existing], ...newPhase };
      } else {
        phases.push(newPhase);
      }

      return { phases };
    }),

  setMissionSnapshot: (snapshot) =>
    set({
      activeMission: snapshot,
      phases: snapshot.phases,
    }),

  addMissionEvent: (event) =>
    set((state) => ({
      missionEvents: [...state.missionEvents, event].slice(-200),
    })),

  setStats: (stats) => set({ stats }),

  resetPipeline: () =>
    set({
      pipelineStatus: null,
      phases: [],
      isPipelineRunning: false,
      missionEvents: [],
    }),
}));