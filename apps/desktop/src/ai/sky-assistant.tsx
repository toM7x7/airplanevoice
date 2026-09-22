import { useEffect, useRef, useState } from "react";
import type { Experience } from "../../../../packages/core/src";
import type { TrialContext } from "../../../../packages/core/src/ai-trial";
import {
  actionAchieved,
  actionProblem,
  actionResult,
  CONTROL_LABELS,
  type AssistantAction,
  type AssistantControl,
} from "../../../../packages/core/src/assistant-actions";
import type { AircraftAudio } from "../audio";

export function skyContext(
  e: Experience,
  audio: AircraftAudio,
  ui: Omit<TrialContext, "revision" | "phase" | "paused" | "fleet">,
  aircraftNames: { id: string; name: string; sourceEntryId?: string }[] = [],
): TrialContext {
  const current = e.getSnapshot();
  const levels = audio.levels;
  return {
    ...ui,
    selectedId: e.flightIds.includes(ui.selectedId as never) ? ui.selectedId : null,
    selected: e.flightIds.includes(ui.selectedId as never),
    revision: Math.floor(current.nowMs),
    phase: current.phase,
    paused: current.paused,
    fleet: e.flightIds.map((id) => {
      // EDIT has no active FlightState yet; expose the configured aircraft as waiting.
      const f = current.fleet.find((f) => f.id === id) ?? {
        id,
        pose: e.pose(id),
        state: "waiting" as const,
        pendingCount: 0,
      };
      const d = {
        x: f.pose.position.x - e.listener.x,
        y: f.pose.position.y - e.listener.y,
        z: f.pose.position.z - e.listener.z,
      };
      const distance = Math.hypot(d.x, d.y, d.z);
      const speed = e.routeFor(f.id).speedMps;
      return {
        id: f.id,
        sourceEntryId: aircraftNames.find(entry => entry.id === f.id)?.sourceEntryId,
        name: aircraftNames.find((entry) => entry.id === f.id)?.name ?? "旅客機",
        state: f.state,
        pendingCount: f.pendingCount,
        distanceM: Math.round(distance),
        radialMps:
          current.paused || f.state !== "flying"
            ? 0
            : Math.round(
                ((d.x * f.pose.tangent.x +
                  d.y * f.pose.tangent.y +
                  d.z * f.pose.tangent.z) /
                  Math.max(1, distance)) *
                  speed,
              ),
        signalDb:
          ui.soundOn && !current.paused && audio.context?.state === "running"
            ? Math.max(
                -120,
                Math.min(20, Math.round(levels.flights[f.id]?.db ?? -120)),
              )
            : -120,
      };
    }),
  };
}
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const visibleControl = (control: string) =>
  Array.from(
    document.querySelectorAll<HTMLElement>(`[data-ai-control="${control}"]`),
  ).find((element) => element.getClientRects().length > 0);
export function useSkyAssistant(
  getContext: () => TrialContext,
  apply: (a: AssistantAction) => boolean | Promise<boolean>,
  reveal: (control: AssistantControl, value?: string) => void,
  spatialTarget?: (a: AssistantAction) => boolean | undefined,
) {
  const current = useRef({ getContext, apply, reveal, spatialTarget });
  current.current = { getContext, apply, reveal, spatialTarget };
  const [guide, setGuide] = useState<{
    action: AssistantAction;
    text: string;
  } | null>(null);
  useEffect(() => {
    if (!guide) return;
    const element = visibleControl(guide.action.control);
    element?.setAttribute("data-ai-highlight", "true");
    element?.scrollIntoView({ block: "center", behavior: "auto" });
    const timer = setTimeout(() => setGuide(null), 45000);
    return () => {
      element?.removeAttribute("data-ai-highlight");
      clearTimeout(timer);
    };
  }, [guide]);
  const execute = async (a: AssistantAction) => {
    const problem = actionProblem(a, current.current.getContext());
    if (problem) {
      setGuide({ action: a, text: problem });
      return false;
    }
    current.current.reveal(a.control, a.value);
    await frame();
    await frame();
    if (a.mode === "guide") {
      // Render the guide into the XR panel before checking its actual target.
      setGuide({ action: a, text: `${CONTROL_LABELS[a.control]}の操作場所を確認しています。` });
      await frame();
      await frame();
      const target = current.current.spatialTarget?.(a) ?? visibleControl(a.control);
      setGuide({
        action: a,
        text: target
          ? `${CONTROL_LABELS[a.control]}を枠で示しています。自分で操作してみましょう。`
          : "この状態では対象が表示されていません。先に飛行や設定画面を確認してください。",
      });
      return !!target;
    }
    const applied = await current.current.apply(a);
    await frame();
    await frame();
    const context = current.current.getContext();
    const ok = applied && actionAchieved(a, context);
    setGuide({
      action: a,
      text: ok
        ? actionResult(a, context, true)
        : a.control === "sound"
          ? "音の開始には一度ボタンを押す必要があります。枠の音ボタンを押してください。"
          : actionResult(a, context, false),
    });
    return ok;
  };
  return {
    execute,
    getContext: () => current.current.getContext(),
    guide,
    clear: () => setGuide(null),
  };
}
export function AssistantGuide({
  text,
  onClose,
}: {
  text: string;
  onClose: () => void;
}) {
  return (
    <div className="av-assistant-guide" role="status">
      <span>{text}</span>
      <button type="button" aria-label="操作の強調を閉じる" onClick={onClose}>
        閉じる
      </button>
    </div>
  );
}
