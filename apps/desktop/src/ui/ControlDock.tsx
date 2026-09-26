import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  activateControl,
  ICON_PATHS,
  type ControlAction,
  type ControlIcon,
  type ControlMenuState,
  type ControlMenuView,
} from "./control-menu";
import type { ControlGuideView } from "./control-guide";

export function ControlIconView({ name }: { name: ControlIcon }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
export function ControlButton({
  action,
  compact = false,
  guided = false,
  ...props
}: {
  action: ControlAction;
  compact?: boolean;
  guided?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      type="button"
      data-action={action.id}
      data-guided={guided || undefined}
      aria-describedby={guided ? "av-guide-instruction" : undefined}
      className={`av-control-button${compact ? " av-control-compact" : ""}`}
      disabled={!!action.disabledReason}
      title={action.disabledReason || action.description}
      onClick={() => activateControl(action)}
    >
      <ControlIconView name={action.icon} />
      {guided && (
        <span className="av-guide-marker" aria-hidden="true">
          ここ
        </span>
      )}
      <span>
        <strong>{action.label}</strong>
        {!compact && (
          <small>{action.disabledReason || action.description}</small>
        )}
      </span>
    </button>
  );
}
export function ControlDock({
  menu,
  view,
  guide,
  onEndGuide,
}: {
  menu: ControlMenuState;
  view: ControlMenuView;
  guide?: ControlGuideView;
  onEndGuide?: () => void;
}) {
  const state = useSyncExternalStore(menu.subscribe, () => menu.snapshot);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  const target = guide?.target;
  useEffect(() => {
    if (!target || target.location !== "panel" || !state.open) return;
    const button = panel.current?.querySelector<HTMLButtonElement>(
      `[data-action="${target.actionId}"]`,
    );
    button?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [target?.actionId, target?.location, state.open, state.page]);
  const guideCard = guide && (
    <aside className="av-guide-card" aria-label="操作案内の練習">
      <div>
        <strong>操作案内の練習</strong>
        <button type="button" onClick={onEndGuide}>
          {guide.status === "active" ? "案内をやめる" : "案内を閉じる"}
        </button>
      </div>
      <p id="av-guide-instruction" role="status" aria-live="polite">
        {guide.instruction}
      </p>
      <small>{guide.detail}</small>
    </aside>
  );
  useEffect(() => {
    if (state.open) panel.current?.focus({ preventScroll: true });
    if (
      !state.open &&
      wasOpen.current &&
      panel.current?.contains(document.activeElement)
    )
      root.current
        ?.querySelector<HTMLButtonElement>('[data-action="menu.toggle"]')
        ?.focus({ preventScroll: true });
    wasOpen.current = state.open;
  }, [state.open, state.page]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.snapshot.open) {
        event.preventDefault();
        menu.close();
      }
    };
    const outside = (event: PointerEvent) => {
      if (
        menu.snapshot.open &&
        root.current &&
        event.target instanceof Node &&
        !root.current.contains(event.target)
      )
        menu.close();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", outside);
    };
  }, [menu]);
  return (
    <div
      className="av-control-dock"
      ref={root}
      data-reduced={state.reduced}
      data-open={state.open}
    >
      {!state.open && guideCard && (
        <div className="av-guide-above-bar">{guideCard}</div>
      )}
      <section
        ref={panel}
        id="av-control-panel"
        className="av-control-panel"
        data-open={state.open}
        inert={!state.open}
        aria-hidden={!state.open}
        aria-labelledby="av-control-title"
        tabIndex={-1}
      >
        <div className="av-control-heading">
          <div>
            <p>AIRPLANEVOICE</p>
            <h2 id="av-control-title">{view.title}</h2>
            <span>{view.description}</span>
          </div>
          <button
            type="button"
            className="av-control-close"
            onClick={menu.close}
            aria-label="メニューを閉じる"
          >
            <ControlIconView name="close" />
          </button>
        </div>
        {state.open && guideCard}
        <div key={state.page} className="av-control-content">
          {view.lines && (
            <ul className="av-control-help">
              {view.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <div className="av-control-grid">
            {view.actions.map((action) => (
              <ControlButton
                key={action.id}
                action={action}
                data-control-location="panel"
                guided={
                  target?.location === "panel" && target.actionId === action.id
                }
              />
            ))}
          </div>
        </div>
        <p className="av-control-foot">
          選んだ操作は、この端末だけに反映されます。
        </p>
      </section>
      <nav className="av-control-bar" aria-label="空の操作">
        {view.dock.map((action) => (
          <ControlButton
            key={action.id}
            action={action}
            compact
            data-control-location="dock"
            guided={
              target?.location === "dock" && target.actionId === action.id
            }
            aria-controls={
              action.id === "menu.toggle" ? "av-control-panel" : undefined
            }
            aria-expanded={action.id === "menu.toggle" ? state.open : undefined}
          />
        ))}
      </nav>
    </div>
  );
}
