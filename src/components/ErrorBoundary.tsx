import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Stops a render error from white-screening the whole desktop app. */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-full grid place-items-center bg-background p-6">
        <div className="card max-w-md text-center">
          <p className="text-lg font-bold text-ink">Something went wrong</p>
          <p className="text-sm text-brand-500 mt-2">
            The app hit an unexpected error. Your data is safe — reload to
            continue.
          </p>
          <pre className="text-[11px] text-brand-400 bg-brand-50 rounded-lg p-3 mt-3 overflow-x-auto text-left">
            {this.state.error.message}
          </pre>
          <button
            className="btn-primary mt-4 mx-auto"
            onClick={() => window.location.reload()}
          >
            Reload app
          </button>
        </div>
      </div>
    );
  }
}
