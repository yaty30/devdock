import React, { Component, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

type FatalErrorState = {
  error: Error | null;
};

class AppErrorBoundary extends Component<
  { children: ReactNode },
  FatalErrorState
> {
  state: FatalErrorState = { error: null };

  static getDerivedStateFromError(error: Error): FatalErrorState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[renderer:fatal]", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return <FatalStartupError error={this.state.error} />;
    }

    return this.props.children;
  }
}

function FatalStartupError({ error }: { error: Error }): JSX.Element {
  return (
    <main className="fatal-startup-screen">
      <section className="fatal-startup-panel">
        <h1>DevDock could not start</h1>
        <p>{error.message || "An unknown renderer error occurred."}</p>
        <pre>{error.stack ?? String(error)}</pre>
      </section>
    </main>
  );
}

function renderFatalError(error: unknown): void {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }

  const normalized =
    error instanceof Error ? error : new Error(String(error ?? "Unknown error"));
  ReactDOM.createRoot(root).render(<FatalStartupError error={normalized} />);
}

window.addEventListener("error", (event) => {
  console.error("[renderer:error]", event.error ?? event.message);
  renderFatalError(event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[renderer:unhandledrejection]", event.reason);
  renderFatalError(event.reason);
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  renderFatalError(new Error("Renderer root element was not found."));
} else {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}
