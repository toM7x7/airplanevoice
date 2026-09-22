import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./style.css";
// Old AI trial links now open the ordinary sky with its assistant.
const entry = new URL(location.href);
if (
  entry.searchParams.get("ui") === "components" &&
  entry.searchParams.get("ai") === "trial"
) {
  entry.searchParams.delete("ui");
  entry.searchParams.set("ai", "guide");
  history.replaceState(null, "", entry.pathname + entry.search + entry.hash);
}
const SharedApp = React.lazy(() =>
  import("./SharedApp").then((module) => ({ default: module.SharedApp })),
);
const ControlLab = React.lazy(() =>
  import("./ControlLab").then((module) => ({ default: module.ControlLab })),
);
const MotionLab = React.lazy(() =>
  import("./MotionLab").then((module) => ({ default: module.MotionLab })),
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
    {new URLSearchParams(location.search).get("ui") === "motion" ? (
      <React.Suspense
        fallback={<main className="fatal">動きの比較を開いています…</main>}
      >
        <MotionLab />
      </React.Suspense>
    ) : new URLSearchParams(location.search).get("ui") === "components" &&
      new URLSearchParams(location.search).get("ai") !== "trial" ? (
      <React.Suspense
        fallback={<main className="fatal">操作部品の試作を開いています…</main>}
      >
        <ControlLab />
      </React.Suspense>
    ) : new URLSearchParams(location.search).has("shared") ||
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
