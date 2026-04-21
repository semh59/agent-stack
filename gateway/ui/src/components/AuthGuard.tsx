import { type ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAppStore } from '../store/appStore';

interface AuthGuardProps {
  children: ReactNode;
}

/**
 * Enhanced AuthGuard:
 * 1. Checks for valid active account
 * 2. Checks token expiry — warns when near expiry
 * 3. Allows accounts page access without auth
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const { activeAccount, accounts } = useAppStore();
  const location = useLocation();
  const [expiryWarning, setExpiryWarning] = useState(false);

  const activeAccountData = accounts.find(a => a.email === activeAccount);
  const hasActive = activeAccount && activeAccountData?.isValid;

  // Token expiry check — warn 5 minutes before expiry
  useEffect(() => {
    if (!activeAccountData?.expiresAt) return;

    const checkExpiry = () => {
      const now = Date.now();
      const timeLeft = activeAccountData.expiresAt - now;
      setExpiryWarning(timeLeft > 0 && timeLeft < 5 * 60 * 1000);
    };

    checkExpiry();
    const interval = setInterval(checkExpiry, 30_000);
    return () => clearInterval(interval);
  }, [activeAccountData?.expiresAt]);

  if (!hasActive) {
    // K8 FIX: Allow bypassing AuthGuard in standalone browser mode or development
    // so the user can navigate the UI to debug without being trapped.
    // @ts-expect-error - VSCode webview API
    const isStandalone = typeof acquireVsCodeApi === 'undefined';
    const isDev = import.meta.env?.DEV;
    
    if (isStandalone || isDev) {
      // Just warn, don't trap
      console.warn('[AuthGuard] Bypassed because isStandalone/isDev. Active account is missing or invalid.');
    } else {
      // Strict mode for VSCode production
      // Allow access to the accounts page itself
      if (location.pathname === '/accounts') {
        return <>{children}</>;
      }
      return <Navigate to="/accounts" state={{ from: location }} replace />;
    }
  }

  return (
    <>
      {expiryWarning && (
        <div className="bg-amber-900/30 border-b border-amber-700/40 px-4 py-2 text-amber-200 text-xs text-center font-ui">
          ⚠️ Token expiring soon. Please re-authenticate your account.
        </div>
      )}
      {children}
    </>
  );
}
