import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Name of the widget for telemetry */
  widgetName: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Granular Widget-level error boundary: wraps individual charts and matrices
 * so a rendering crash inside one doesn't take down the entire page.
 */
export class WidgetErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false, error: null };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[WidgetErrorBoundary:${this.props.widgetName}]`, error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full min-h-[160px] bg-red-950/20 border border-red-900/30 rounded-xl p-4 flex flex-col items-center justify-center text-center">
          <AlertTriangle className="text-red-500/80 mb-2" size={24} />
          <h3 className="text-xs font-bold text-red-400 uppercase tracking-widest mb-1">
            {this.props.widgetName} Hatası
          </h3>
          <p className="text-[10px] text-red-200/60 mb-3 max-w-[200px] truncate">
            {this.state.error?.message || 'Bilinmeyen işleme hatası'}
          </p>
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-1.5 px-3 py-1 bg-red-900/40 hover:bg-red-800/60 border border-red-800/50 rounded-lg text-red-300 text-[9px] uppercase tracking-wider transition-colors"
          >
            <RefreshCw size={10} /> Yeniden Yükle
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
