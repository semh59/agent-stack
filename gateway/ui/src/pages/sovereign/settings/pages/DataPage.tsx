/**
 * Data page — where Alloy stores its persistent state on disk.
 */
import { Database, HardDrive, Files, ShieldAlert } from "lucide-react";
import { Input, Row, Section } from "../../../../components/sovereign/primitives";
import { useAlloyStore } from "../../../../store/alloyStore";
import { getAtPath, useEffectiveSettings } from "../useEffectiveSettings";
import type { ChangeEvent } from "react";

export function DataPage() {
  const effective = useEffectiveSettings();
  const { updateSettingsPath } = useAlloyStore();

  return (
    <div className="space-y-12 pb-20">
      <div className="flex items-center gap-4 p-6 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl mb-8">
        <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
           <Database size={20} />
        </div>
        <div>
           <h2 className="text-sm font-bold uppercase tracking-widest text-white">Storage_Vault_Infrastructure</h2>
           <p className="text-[10px] text-white/40 mt-1 font-medium tracking-tight">Manage persistent data volumes and state serialization paths.</p>
        </div>
      </div>

      <Section
        title="Physical_Data_Mount"
        description="Root folder for SQLite databases, vector shard indexes, and mission telemetry logs."
        icon={<HardDrive size={16} />}
      >
        <div className="bg-black/40 border border-white/5 rounded-2xl p-8 space-y-6">
          <Row
            label="KERNEL_DATA_DIR"
            hint="Must be writable by the OS process. Deployment standard: /var/lib/alloy."
          >
            <div className="flex items-center gap-3 bg-black/60 border border-white/5 rounded-lg px-4 h-12 w-full max-w-xl group-focus-within:border-emerald-500/30 transition-all">
              <Files size={14} className="text-white/20" />
              <Input
                value={getAtPath<string>(effective, "data.data_dir", "") ?? ""}
                onChange={(e: ChangeEvent<HTMLInputElement>) => updateSettingsPath("data.data_dir", e.target.value)}
                placeholder="/var/lib/alloy/data"
                className="bg-transparent border-none p-0 focus:ring-0 text-xs font-mono text-white flex-1"
              />
            </div>
          </Row>

          <div className="p-4 bg-amber-500/5 border border-amber-500/10 rounded-xl flex items-start gap-3">
             <ShieldAlert size={16} className="text-amber-500/40 mt-0.5" />
             <div>
                <span className="block text-[10px] font-bold text-amber-500/60 uppercase tracking-widest">Write_Permission_Active</span>
                <p className="text-[10px] text-amber-500/30 mt-1 uppercase leading-tight">Changing this path requires a full kernel restart to re-initialize databases.</p>
             </div>
          </div>
        </div>
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl flex flex-col items-center text-center">
            <span className="text-[9px] font-bold text-white/20 uppercase tracking-[0.2em] mb-4">Database_Index</span>
            <div className="text-xs font-mono text-emerald-400/60">SQLITE_V3_AES</div>
         </div>
         <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl flex flex-col items-center text-center">
            <span className="text-[9px] font-bold text-white/20 uppercase tracking-[0.2em] mb-4">Vector_Engine</span>
            <div className="text-xs font-mono text-emerald-400/60">HNSW_LIB_LOCAL</div>
         </div>
         <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl flex flex-col items-center text-center">
            <span className="text-[9px] font-bold text-white/20 uppercase tracking-[0.2em] mb-4">Log_Retention</span>
            <div className="text-xs font-mono text-emerald-400/60">EPOCH_ROTATION_14D</div>
         </div>
      </div>
    </div>
  );
}
