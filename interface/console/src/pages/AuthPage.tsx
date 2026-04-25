import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { AlertCircle } from 'lucide-react';
import type { GoogleAccount } from '../store/types';
import { readGatewayToken } from '../store/helpers';

export function AuthPage() {
  const navigate = useNavigate();
  const { addAccount, accounts, lastError, isConnecting } = useAppStore();
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [apiError] = useState<string | null>(null);
  const gatewayToken = useAppStore(state => state.gatewayToken);

  const handleGoogleLogin = () => {
    addAccount('google');
  };

  const handleReset = () => {
    sessionStorage.clear();
    useAppStore.setState({ lastError: null, gatewayToken: readGatewayToken() });
    window.location.reload();
  };

  const handleClaudeLogin = () => {
    addAccount('claude');
  };

  const handleGuestLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    // Add a mock valid account so AuthGuard lets us through
    const mockAccount: GoogleAccount = { 
      email, 
      status: 'active', 
      isValid: true, 
      expiresAt: Date.now() + 24 * 60 * 60 * 1000 
    };
    
    // Set the dev token so we can actually talk to the gateway
    const devToken = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_GATEWAY_TOKEN || "dev-local-token";
    sessionStorage.setItem('gateway_auth_token', devToken);
    
    // Clean state update via setState to ensure Zustand notifies observers
    const updatedAccounts = accounts.find(a => a.email === email) 
       ? accounts 
       : [...accounts, mockAccount];
    
    useAppStore.setState({ 
      accounts: updatedAccounts, 
      activeAccount: email,
      gatewayToken: devToken,
      lastError: null 
    });
    navigate('/chat');
  };

  return (
    <div className="min-h-screen bg-[var(--color-alloy-bg)] flex items-center justify-center relative overflow-hidden">
      {/* Background geometrical effect */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[20%] left-[30%] w-[40vw] h-[40vw] bg-[var(--color-alloy-accent)]/5 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[20%] right-[20%] w-[30vw] h-[30vw] bg-[var(--color-alloy-mgmt)]/5 rounded-full blur-[100px]" />
      </div>

      <div className="z-10 w-full max-w-md p-8 rounded-xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)]/80 backdrop-blur-xl shadow-2xl flex flex-col items-center text-center">
        {/* Store Error Alert */}
        {lastError && (
          <div className="w-full mb-6 p-4 rounded-md bg-red-500/10 border border-red-500/30 flex flex-col gap-3 text-left">
            <div className="flex gap-2">
              <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400 font-bold">AUTH ERROR</p>
            </div>
            <p className="text-[10px] text-red-400/80 font-mono break-all">{lastError}</p>
            
            {import.meta.env?.DEV && (
              <div className="text-[8px] opacity-50 font-mono mt-1 border-t border-white/5 pt-2">
                Trace: Token {gatewayToken ? `Found (${gatewayToken.slice(0, 4)}...)` : 'Missing'} | URL: {window.location.origin}
              </div>
            )}

            <button 
              onClick={handleReset}
              className="text-[9px] uppercase tracking-tighter font-bold text-white bg-red-600/20 hover:bg-red-600/40 px-3 py-1.5 rounded border border-red-500/30 self-start transition-colors"
            >
              Force Reset & Reload
            </button>
          </div>
        )}

        <h1 className="text-4xl font-display tracking-widest text-white mb-2">
          {t('ALLOY')}
        </h1>
        <p className="text-[var(--color-alloy-text-sec)] text-sm tracking-wide font-ui mb-10">
          {t('Alloy Software Factory')}
        </p>

        {/* API Error Alert */}
        {apiError && (
          <div className="w-full mb-4 p-3 rounded-md bg-red-500/10 border border-red-500/30 flex gap-2">
            <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-400">{apiError}</p>
          </div>
        )}

        <div className="w-full space-y-4">
          <button
            onClick={handleGoogleLogin}
            disabled={isConnecting}
            className="w-full flex items-center justify-center gap-3 bg-white text-black py-3 px-6 rounded-md hover:bg-gray-100 transition-all font-bold text-[10px] uppercase tracking-widest shadow-xl shadow-blue-500/10 active:scale-95 disabled:opacity-50"
          >
            <img src="https://www.google.com/favicon.ico" className="w-4 h-4" alt="" />
            {isConnecting ? 'Initiating Link...' : 'Sign in with Google'}
          </button>

          <button
            onClick={handleClaudeLogin}
            disabled={isConnecting}
            className="w-full flex items-center justify-center gap-3 bg-white/5 border border-white/10 text-white py-3 px-6 rounded-md hover:bg-white/10 transition-all font-bold text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-50"
          >
            <div className="w-4 h-4 bg-orange-500 rounded-full blur-[2px]" />
            {isConnecting ? 'Connecting...' : 'Sign in with Claude'}
          </button>

          <div className="flex items-center gap-4 py-4">
            <div className="h-px flex-1 bg-white/5" />
            <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest">or guest session</span>
            <div className="h-px flex-1 bg-white/5" />
          </div>

          <form onSubmit={handleGuestLogin} className="space-y-4">
             <div className="space-y-1 text-left">
               <input
                 type="email"
                 value={email}
                 onChange={(e) => setEmail(e.target.value)}
                 placeholder="Enter email to skip auth"
                 className="w-full bg-black/40 border border-white/5 rounded-md px-4 py-2 text-[10px] text-white/60 focus:outline-none focus:border-[var(--color-alloy-accent)] transition-colors"
               />
             </div>
             <button
               type="submit"
               className="w-full text-[9px] font-bold text-white/40 hover:text-white transition-colors uppercase tracking-widest"
             >
               Enter as Guest
             </button>
          </form>
        </div>

        <div className="mt-8 text-xs text-[var(--color-alloy-text-sec)] space-y-2 border-t border-[var(--color-alloy-border)] pt-6 w-full">
          <p>{t('The first account becomes the factory account.')}</p>
          <p>{t('You can add more accounts later for quota rotation.')}</p>
        </div>
      </div>
    </div>
  );
}
