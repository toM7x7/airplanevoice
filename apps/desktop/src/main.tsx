import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./style.css";
const SharedApp = React.lazy(() =>
  import("./SharedApp").then((module) => ({ default: module.SharedApp })),
);

class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { message: string | null }
> {
  state: { message: string | null } = { message: null };
  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }
  render() {
    return this.state.message ? (
      <main className="fatal">
        <h1>空を開けませんでした</h1>
        <p>{this.state.message}</p>
        <button onClick={() => location.reload()}>もう一度開く</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    {new URLSearchParams(location.search).has("shared") ||
    new URLSearchParams(location.search).has("room") ? (
      <React.Suspense
        fallback={<main className="fatal">共有する空を開いています…</main>}
      >
        <SharedApp />
      </React.Suspense>
    ) : (
      <App />
    )}
  </ErrorBoundary>,
);
