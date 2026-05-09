import { fetchJson } from "../utils/api";

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  status: string;
}

export async function fetchModels(): Promise<ModelEntry[]> {
  const res = await fetchJson<ModelEntry[]>("/api/models");
  if (res.errors && res.errors.length > 0) throw new Error(res.errors[0].message);
  return res.data || [];
}

export interface SystemStats {
  projects: { total: number; completedThisMonth: number };
  skills: { active: number; total: number };
  accounts: { total: number; activeEmail: string | null; usagePercentage: number };
  models: { active: number };
}

export async function fetchStats(): Promise<SystemStats> {
  const res = await fetchJson<SystemStats>("/api/stats");
  if (res.errors && res.errors.length > 0) throw new Error(res.errors[0].message);
  return res.data!;
}
