import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

interface Props {
  children: ReactNode;
  /** When this value changes, a caught error is cleared. Pass the route path
   *  so navigating away from a crashed page recovers automatically. */
  resetKey?: unknown;
}

/** Stops a render error from white-screening the whole desktop app. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-full grid place-items-center bg-background p-6">
        <div className="card max-w-md text-center">
          <p className="text-lg font-medium text-ink">Something went wrong</p>
          <p className="text-sm text-brand-500 mt-2">
            The app hit an unexpected error. Your data is safe — reload to continue.
          </p>
          <pre className="text-[11px] text-brand-400 bg-brand-50 rounded-xl p-3 mt-3 overflow-x-auto text-left">
            {this.state.error.message}
          </pre>
          <div className="flex gap-2 justify-center mt-4">
            <button className="btn-ghost" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
