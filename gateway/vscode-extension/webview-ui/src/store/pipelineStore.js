/* ═══════════════════════════════════════════════════════════════════
   Pipeline Store — Zustand state for pipeline & mission tracking
   ═══════════════════════════════════════════════════════════════════ */
import { create } from "zustand";
export const usePipelineStore = create((set) => ({
    pipelineStatus: null,
    phases: [],
    isPipelineRunning: false,
    activeMission: null,
    missionEvents: [],
    stats: null,
    setPipelineStatus: (status) => set({
        pipelineStatus: status,
        isPipelineRunning: status.status.status === "running" || status.status.status === "active",
    }),
    updatePhase: (phase) => set((state) => {
        const existing = state.phases.findIndex((p) => p.name === phase.phase);
        const newPhase = {
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
        }
        else {
            phases.push(newPhase);
        }
        return { phases };
    }),
    setMissionSnapshot: (snapshot) => set({
        activeMission: snapshot,
        phases: snapshot.phases,
    }),
    addMissionEvent: (event) => set((state) => ({
        missionEvents: [...state.missionEvents, event].slice(-200),
    })),
    setStats: (stats) => set({ stats }),
    resetPipeline: () => set({
        pipelineStatus: null,
        phases: [],
        isPipelineRunning: false,
        missionEvents: [],
    }),
}));
