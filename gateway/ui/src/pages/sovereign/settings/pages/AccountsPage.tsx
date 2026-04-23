import { Users, Trash2, Plus, ChevronRight, ShieldAlert, Fingerprint, Lock, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../../store/appStore';
import { 
  Row, 
  Section 
} from '../../../../components/sovereign/primitives';
import clsx from 'clsx';

export function AccountsPage() {
  const { t } = useTranslation();
  const { 
    accounts, 
    activeAccount, 
    removeAccount,
    addAccount,
    accountQuotas
  } = useAppStore(useShallow(state => ({
    accounts: state.accounts,
    activeAccount: state.activeAccount,
    removeAccount: state.removeAccount,
    addAccount: state.addAccount,
    accountQuotas: state.accountQuotas
  })));

  return (
    <div className="space-y-12 pb-20">
      <div className="flex items-center justify-between p-6 bg-indigo-500/5 border border-indigo-500/10 rounded-2xl mb-8">
        <div className="flex items-center gap-4">
          <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.3)]">
             <Users size={20} />
          </div>
          <div>
             <h2 className="text-sm font-bold uppercase tracking-widest text-white">Account Management</h2>
             <p className="text-[10px] text-white/40 mt-1 font-medium tracking-tight">Manage authorized accounts and session quotas for your engineering tasks.</p>
          </div>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={() => addAccount('google')}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-blue-400 hover:bg-white/10 transition-all"
          >
            <Plus size={14} />
            Connect Google
          </button>
          <button 
            onClick={() => addAccount('claude')}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-orange-400 hover:bg-white/10 transition-all"
          >
            <Plus size={14} />
            Connect Claude
          </button>
        </div>
      </div>

      <Section 
        title="Connected Accounts" 
        description="Active identities currently linked to the system."
        icon={<Fingerprint size={16} />}
      >
        <div className="grid gap-4">
          {accounts.map((acc) => (
            <div 
              key={acc.email} 
              className={clsx(
                "group relative bg-black/40 border rounded-2xl p-6 transition-all duration-300 hover:bg-white/[0.02] shadow-alloy-elevated overflow-hidden",
                acc.email === activeAccount ? "border-[var(--color-alloy-accent)]/40 shadow-alloy-glow" : "border-white/5"
              )}
            >
              {acc.email === activeAccount && (
                <div className="absolute top-0 left-0 w-1 h-full bg-[var(--color-alloy-accent)] shadow-[0_0_10px_rgba(var(--accent-rgb),0.5)]" />
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="w-12 h-12 rounded-xl bg-black border border-white/10 flex items-center justify-center text-base font-black text-white uppercase shadow-inner">
                    {acc.email[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-white uppercase tracking-tight">{acc.email}</span>
                      {acc.email === activeAccount && (
                        <span className="px-2 py-0.5 rounded text-[8px] font-black bg-[var(--color-alloy-accent)] text-black uppercase tracking-[0.2em]">Active</span>
                      )}
                    </div>
                    
                    {/* Quota Mini Bar */}
                    <div className="mt-3 flex flex-wrap gap-4">
                       {accountQuotas.find(q => q.email === acc.email)?.quota && (
                         Object.entries(accountQuotas.find(q => q.email === acc.email)!.quota!).map(([key, val]) => (
                           <div key={key} className="flex flex-col gap-1.5 min-w-[120px]">
                              <div className="flex justify-between items-center pr-2">
                                <span className="text-[8px] text-white/20 font-bold uppercase tracking-widest">{key}</span>
                                <span className="text-[8px] text-white/40 font-mono">{(val.remainingFraction || 0) * 100}%</span>
                              </div>
                              <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                <div 
                                  className={clsx(
                                    "h-full transition-all duration-500",
                                    (val.remainingFraction || 0) < 0.2 ? "bg-red-500" : "bg-[var(--color-alloy-accent)] shadow-[0_0_5px_rgba(var(--accent-rgb),0.5)]"
                                  )}
                                  style={{ width: `${(val.remainingFraction || 0) * 100}%` }}
                                />
                              </div>
                           </div>
                         ))
                       )}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => removeAccount(acc.email)}
                    className="p-3 text-white/10 hover:text-red-400 hover:bg-red-500/10 rounded-xl border border-transparent hover:border-red-500/20 transition-all opacity-0 group-hover:opacity-100"
                    title={t("Revoke_Identity")}
                  >
                    <Trash2 size={16} />
                  </button>
                  <ChevronRight size={18} className="text-white/10 group-hover:text-white/40 transition-colors" />
                </div>
              </div>
            </div>
          ))}
          
          {accounts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 border border-dashed border-white/5 rounded-3xl bg-black/20">
              <Lock size={48} className="mb-6 text-white/5" />
              <p className="text-xs font-bold uppercase tracking-widest text-white/20">No active principals found.</p>
              <button 
                className="mt-6 px-6 py-2 bg-indigo-500/20 border border-indigo-500/20 rounded-lg text-[10px] font-bold text-indigo-100 uppercase tracking-widest hover:bg-indigo-500/40"
                onClick={() => addAccount()}
              >
                Add first account
              </button>
            </div>
          )}
        </div>
      </Section>

      <div className="h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />

      <Section 
        title="System Status" 
        icon={<ShieldAlert size={16} />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-1 bg-white/[0.02] border border-white/5 rounded-3xl">
            <div className="p-6 bg-black/40 border border-white/5 rounded-2xl">
               <Row label="Gateway Status" hint="Real-time link status to the gateway server.">
                  <div className="flex items-center gap-2 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded text-[9px] font-black text-emerald-400 uppercase tracking-[0.2em]">
                     <ShieldCheck size={10} />
                     Connected
                  </div>
               </Row>
            </div>
            <div className="p-6 bg-black/40 border border-white/5 rounded-2xl">
               <Row label="Data Integrity" hint="Validation of persistent state synchronization.">
                  <div className="flex items-center gap-2 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded text-[9px] font-black text-emerald-400 uppercase tracking-[0.2em]">
                     <ShieldCheck size={10} />
                     Synced
                  </div>
               </Row>
            </div>
        </div>
      </Section>
    </div>
  );
}
