import { 
  Users, 
  Trash2, 
  Plus, 
  Sun, 
  Moon, 
  ChevronRight,
  AlertCircle,
  ShieldAlert
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { clsx } from 'clsx';

export function SettingsView() {
  const { 
    accounts, 
    activeAccount, 
    theme, 
    toggleTheme, 
    removeAccount,
    addAccount 
  } = useAppStore();

  return (
    <div className="flex flex-col h-full bg-[var(--color-loji-bg)]">
      
      {/* Header */}
      <div className="h-16 border-b border-[var(--color-loji-border)] flex items-center px-8 bg-[var(--color-loji-surface)] shrink-0">
        <h2 className="text-lg font-display text-white tracking-widest uppercase">KONTROL MERKEZİ</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-8 max-w-4xl w-full mx-auto space-y-12 pb-20">
        
        {/* Account Management Section */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20">
                <Users size={20} />
              </div>
              <div>
                <h3 className="text-white font-medium">Yetkili Hesaplar</h3>
                <p className="text-xs text-[var(--color-loji-text-sec)]">Ajanların erişim sağladığı sistem hesapları.</p>
              </div>
            </div>
            <button 
              onClick={() => addAccount()} 
              className="flex items-center gap-2 px-6 py-2.5 bg-white text-black text-xs font-bold rounded-xl hover:bg-gray-200 transition-all uppercase tracking-wider shadow-xl"
            >
              <Plus size={16} /> HESAP EKLE
            </button>
          </div>

          <div className="grid gap-3">
            {accounts.map((acc) => (
              <div 
                key={acc.email} 
                className={clsx(
                  "flex items-center justify-between p-4 bg-[var(--color-loji-surface)] border rounded-2xl transition-all group",
                  acc.email === activeAccount 
                    ? "border-[var(--color-loji-accent)] shadow-[0_0_15px_rgba(var(--color-loji-accent-rgb),0.1)]" 
                    : "border-[var(--color-loji-border)] hover:border-gray-700"
                )}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-[var(--color-loji-bg)] border border-[var(--color-loji-border)] flex items-center justify-center text-sm font-bold text-white uppercase overflow-hidden shadow-inner">
                    {acc.email[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{acc.email}</span>
                      {acc.email === activeAccount && (
                        <span className="text-[10px] bg-[var(--color-loji-accent)]/10 text-[var(--color-loji-accent)] px-2 py-0.5 rounded-lg border border-[var(--color-loji-accent)]/20 font-bold uppercase tracking-tighter">AKTİF</span>
                      )}
                    </div>
                    {/* Quota Mini Bar */}
                    <div className="mt-2 flex items-center gap-2">
                       {useAppStore.getState().accountQuotas.find(q => q.email === acc.email)?.quota && (
                         Object.entries(useAppStore.getState().accountQuotas.find(q => q.email === acc.email)!.quota!).slice(0, 1).map(([key, val]) => (
                           <div key={key} className="flex items-center gap-2">
                             <div className="w-20 h-1 bg-gray-800 rounded-full overflow-hidden">
                               <div 
                                 className={clsx(
                                   "h-full transition-all duration-500",
                                   (val.remainingFraction || 0) < 0.2 ? "bg-red-500" : "bg-[var(--color-loji-success)]"
                                 )}
                                 style={{ width: `${(val.remainingFraction || 0) * 100}%` }}
                               />
                             </div>
                             <span className="text-[9px] text-gray-500 font-bold uppercase tracking-tighter">{key}</span>
                           </div>
                         ))
                       )}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => removeAccount(acc.email)}
                    className="p-2.5 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                    title="Hesabı Kaldır"
                  >
                    <Trash2 size={18} />
                  </button>
                  <ChevronRight size={18} className="text-gray-800" />
                </div>
              </div>
            ))}
            
            {accounts.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-[var(--color-loji-border)] rounded-3xl text-[var(--color-loji-text-sec)] bg-[var(--color-loji-surface)]/30">
                <ShieldAlert size={40} className="mb-4 opacity-10" />
                <p className="text-sm font-body">Yetkilendirilmiş bir hesap henüz tanımlanmadı.</p>
                <button onClick={() => addAccount()} className="text-[var(--color-loji-accent)] text-xs mt-3 font-bold hover:underline tracking-widest uppercase">SİSTEMİ YETKİLENDİR</button>
              </div>
            )}
          </div>
        </section>

        <div className="h-px bg-gradient-to-r from-transparent via-[var(--color-loji-border)] to-transparent opacity-50" />

        {/* Global Settings Section */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-10">
          
          {/* Theme Section */}
          <div className="p-6 bg-[var(--color-loji-surface)] border border-[var(--color-loji-border)] rounded-3xl space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center text-yellow-500 border border-yellow-500/20">
                {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
              </div>
              <h3 className="text-sm font-bold text-white uppercase tracking-widest">TEMEL TEMA</h3>
            </div>
            <div className="flex p-1.5 bg-[var(--color-loji-bg)] border border-[var(--color-loji-border)] rounded-2xl w-full">
              <button 
                onClick={() => theme !== 'light' && toggleTheme()}
                className={clsx(
                  "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                  theme === 'light' ? "bg-white text-black shadow-xl" : "text-[var(--color-loji-text-sec)] hover:text-white"
                )}
              >
                <Sun size={14} /> AYDINLIK
              </button>
              <button 
                onClick={() => theme !== 'dark' && toggleTheme()}
                className={clsx(
                  "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                  theme === 'dark' ? "bg-[var(--color-loji-surface)] text-white shadow-xl border border-white/10" : "text-[var(--color-loji-text-sec)] hover:text-white"
                )}
              >
                <Moon size={14} /> KARANLIK
              </button>
            </div>
          </div>

          {/* Status Section */}
          <div className="p-6 bg-gradient-to-br from-[var(--color-loji-accent)]/[0.05] to-transparent border border-[var(--color-loji-accent)]/20 rounded-3xl space-y-4">
             <div className="flex items-center gap-3">
               <div className="w-8 h-8 rounded-lg bg-[var(--color-loji-success)]/10 flex items-center justify-center text-[var(--color-loji-success)] border border-[var(--color-loji-success)]/20">
                 <AlertCircle size={16} />
               </div>
               <h3 className="text-sm font-bold text-white uppercase tracking-widest">SİSTEM DURUMU</h3>
             </div>
             <div className="space-y-4 pt-2">
               <div className="flex justify-between items-center text-[10px] font-ui uppercase tracking-tighter">
                 <span className="text-[var(--color-loji-text-sec)]">Ajan Bağlantısı:</span>
                 <span className="text-[var(--color-loji-success)] font-bold">AKTİF</span>
               </div>
               <div className="flex justify-between items-center text-[10px] font-ui uppercase tracking-tighter">
                 <span className="text-[var(--color-loji-text-sec)]">Veritabanı Senk:</span>
                 <span className="text-[var(--color-loji-success)] font-bold">TAMAMLANDI</span>
               </div>
               <div className="h-1 w-full bg-gray-800 rounded-full overflow-hidden">
                 <div className="h-full w-full bg-gradient-to-r from-[var(--color-loji-success)] to-emerald-400" />
               </div>
             </div>
          </div>

        </section>

      </div>
    </div>
  );
}
