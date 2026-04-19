import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Optional fallback label for where the error occurred */
  pageName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Page-level error boundary: wraps individual pages so a crash
 * in one page doesn't take down the entire app shell (sidebar, nav).
 */
export class PageErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false, error: null };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[PageErrorBoundary:${this.props.pageName ?? 'unknown'}]`, error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-sm w-full bg-[var(--color-loji-surface)] border border-red-900/30 rounded-xl p-6 shadow-lg">
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-red-900/20 rounded-full flex items-center justify-center mb-4">
                <AlertCircle className="text-red-500" size={24} />
              </div>

              <h2 className="text-lg font-display text-white mb-1">
                {this.props.pageName ?? 'Sayfa'} Hatası
              </h2>
              <p className="text-[var(--color-loji-text-sec)] text-xs mb-4">
                Bu sayfa yüklenirken bir hata oluştu. Diğer sayfalar hâlâ çalışır durumda.
              </p>

              <div className="w-full bg-black/40 rounded-lg p-3 mb-4 text-left overflow-auto max-h-24">
                <code className="text-xs text-red-100 font-mono">
                  {this.state.error?.message || 'Unknown Error'}
                </code>
              </div>

              <button
                onClick={this.handleRetry}
                className="flex items-center justify-center gap-2 bg-[var(--color-loji-accent)] hover:bg-[var(--color-loji-accent)]/80 text-white px-5 py-2.5 rounded-lg font-ui text-sm transition-all w-full"
              >
                <RefreshCw size={16} /> Tekrar Dene
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
