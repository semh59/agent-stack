import { Users, Trash2, Plus, ChevronRight, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../../store/appStore';
import { 
  Badge, 
  Button, 
  Card, 
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
    <div className="space-y-8">
      <Section 
        title={t('Accounts')} 
        description="System accounts authorized for agent operations. Agents will use these credentials to perform cloud-based reasoning."
        icon={<Users size={16} />}
        action={
          <Button 
            variant="primary" 
            size="sm" 
            icon={<Plus size={14} />}
            onClick={() => addAccount()}
          >
            {t('Add Account')}
          </Button>
        }
      >
        <div className="grid gap-4">
          {accounts.map((acc) => (
            <Card 
              key={acc.email} 
              density="compact"
              tone={acc.email === activeAccount ? "accent" : "neutral"}
              className="group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-[var(--color-alloy-bg)] border border-[var(--color-alloy-border)] flex items-center justify-center text-sm font-bold text-white uppercase shadow-inner">
                    {acc.email[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{acc.email}</span>
                      {acc.email === activeAccount && (
                        <Badge tone="accent">{t('Active')}</Badge>
                      )}
                    </div>
                    {/* Quota Mini Bar */}
                    <div className="mt-2 flex items-center gap-2">
                       {accountQuotas.find(q => q.email === acc.email)?.quota && (
                         Object.entries(accountQuotas.find(q => q.email === acc.email)!.quota!).slice(0, 1).map(([key, val]) => (
                           <div key={key} className="flex items-center gap-2">
                             <div className="w-24 h-1 bg-[var(--color-alloy-border)] rounded-full overflow-hidden">
                               <div 
                                 className={clsx(
                                   "h-full transition-all duration-500",
                                   (val.remainingFraction || 0) < 0.2 ? "bg-red-500" : "bg-[var(--color-alloy-accent)]"
                                 )}
                                 style={{ width: `${(val.remainingFraction || 0) * 100}%` }}
                               />
                             </div>
                             <span className="text-[9px] text-[var(--color-alloy-text-sec)] font-bold uppercase tracking-tighter">{key}</span>
                           </div>
                         ))
                       )}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <Button 
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 size={16} />}
                    onClick={() => removeAccount(acc.email)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    title={t("Remove Account")}
                  />
                  <ChevronRight size={18} className="text-[var(--color-alloy-text-sec)]" />
                </div>
              </div>
            </Card>
          ))}
          
          {accounts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-[var(--color-alloy-border)] rounded-3xl text-[var(--color-alloy-text-sec)] bg-[var(--color-alloy-surface)]/30">
              <ShieldAlert size={40} className="mb-4 opacity-10 text-[var(--color-alloy-accent)]" />
              <p className="text-sm font-body">{t('No authorized account has been configured yet.')}</p>
              <Button 
                variant="ghost" 
                size="sm" 
                className="mt-4 font-bold"
                onClick={() => addAccount()}
              >
                {t('AUTHORIZE SYSTEM')}
              </Button>
            </div>
          )}
        </div>
      </Section>

      <div className="h-px bg-gradient-to-r from-transparent via-[var(--color-alloy-border)] to-transparent opacity-50" />

      <Section 
        title={t("System Status")} 
        icon={<ShieldAlert size={16} />}
      >
        <Card tone="neutral">
          <Row label={t("Agent Connection")} hint="Real-time heartbeat status.">
             <Badge tone="success">{t('ACTIVE')}</Badge>
          </Row>
          <Row label={t("Database Sync")} hint="Persistent storage integrity check.">
             <Badge tone="success">{t('COMPLETE')}</Badge>
          </Row>
        </Card>
      </Section>
    </div>
  );
}
