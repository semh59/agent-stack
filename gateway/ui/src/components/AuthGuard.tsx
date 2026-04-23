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
    const isDev = import.meta.env?.DEV;
    
    if (isDev) {
      // In development, only warn to avoid trapping the developer
      console.warn('[AuthGuard] Account invalid. Warning only because isDev.');
    } else {
      // Strict mode for Production
      if (location.pathname === '/auth') {
        return <>{children}</>;
      }
      return <Navigate to="/auth" state={{ from: location }} replace />;
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
