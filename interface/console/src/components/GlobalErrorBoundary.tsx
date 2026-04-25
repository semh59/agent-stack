import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[var(--color-alloy-bg)] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[var(--color-alloy-surface)] border border-red-900/30 rounded-xl p-8 shadow-2xl">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-red-900/20 rounded-full flex items-center justify-center mb-6">
                <AlertCircle className="text-red-500" size={32} />
              </div>
              
              <h1 className="text-2xl font-display text-white mb-2">Oops! Something went wrong</h1>
              <p className="text-[var(--color-alloy-text-sec)] text-sm mb-8">
                The application encountered an unexpected error. Don't worry, your data is safe.
              </p>

              <div className="w-full bg-black/40 rounded-lg p-4 mb-8 text-left overflow-auto max-h-32">
                 <code className="text-xs text-red-100 font-mono">
                   {this.state.error?.message || 'Unknown Error'}
                 </code>
              </div>

              <div className="flex flex-col w-full gap-3">
                <button
                  onClick={() => window.location.reload()}
                  className="flex items-center justify-center gap-2 bg-[var(--color-alloy-accent)] hover:bg-[var(--color-alloy-accent)]/80 text-white px-6 py-3 rounded-lg font-ui text-sm transition-all"
                >
                  <RefreshCw size={18} /> Sayfayı Yenile
                </button>
                <button
                  onClick={() => window.location.href = '/'}
                  className="flex items-center justify-center gap-2 bg-[var(--color-alloy-bg)] border border-[var(--color-alloy-border)] text-[var(--color-alloy-text-sec)] hover:text-white px-6 py-3 rounded-lg font-ui text-sm transition-all"
                >
                  <Home size={18} /> Return to Mission Control
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
