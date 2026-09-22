import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Experience, type FlightId } from "../../../packages/core/src";
import { AircraftAudio } from "./audio";
import { Scene, type ViewState } from "./Scene";
import { VrRuntime } from "./vr";
import { ControlDock } from "./ui/ControlDock";
import { ControlMenuState, controlMenuView } from "./ui/control-menu";
import { SpatialControlMenu } from "./ui/spatial-control-surface";
import {
  beginVolumeGuide,
  describeControlGuide,
  type ControlGuideSession,
} from "./ui/control-guide";
import "./ui/control-lab.css";
import { AiTrialPanel } from "./ai/AiTrialPanel";
import type { TrialContext } from "../../../packages/core/src/ai-trial";

/** Local interaction workbench. Does not read or write saved flights or shared rooms. */
export function ControlLab() {
  const [experience] = useState(() => new Experience());
  const [audio] = useState(() => new AircraftAudio());
  const [vr] = useState(() => new VrRuntime(experience, audio));
  const [menu] = useState(() => {
    const m = new ControlMenuState();
    m.set({ reduced: matchMedia("(prefers-reduced-motion: reduce)").matches });
    return m;
  });
  const [surface] = useState(() => new SpatialControlMenu(menu));
  const menuState = useSyncExternalStore(menu.subscribe, () => menu.snapshot);
  const xr = useSyncExternalStore(vr.subscribe, () => vr.snapshot);
  const flight = useSyncExternalStore(
    experience.subscribe,
    () => experience.snapshot,
  );
  const [selected, setSelected] = useState<FlightId | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [audioPending, setAudioPending] = useState(false);
  const [volume, setVolume] = useState(35);
  const [message, setMessage] = useState("");
  const [guide, setGuide] = useState<ControlGuideSession | null>(null);
  const [guideNow, setGuideNow] = useState(Date.now);
  const audioIntent = useRef(0);
  const view = useRef<ViewState>({ yaw: 0, pitch: 0.22, zoom: false });
  const manual = useRef(false);
  const presenting = xr.status === "presenting";
  const guideView = guide
    ? describeControlGuide(guide, menuState, { volume, soundOn }, guideNow)
    : undefined;
  const guideVisible = !!guideView;
  const beginGuide = () => {
    const now = Date.now();
    setGuideNow(now);
    setGuide(beginVolumeGuide(volume, now));
    setMessage("");
  };
  const aiContext = (): TrialContext => {
    const current = experience.getSnapshot();
    return {
      revision: Math.floor(current.nowMs),
      phase: current.phase,
      paused: current.paused,
      volume,
      soundOn,
      menuOpen: menu.snapshot.open,
      menuPage: menu.snapshot.page,
      selected: selected !== null,
      fleet: current.fleet.map((f) => ({
        id: f.id,
        state: f.state,
        pendingCount: f.pendingCount,
        distanceM: Math.round(
          Math.hypot(
            f.pose.position.x - experience.listener.x,
            f.pose.position.y - experience.listener.y,
            f.pose.position.z - experience.listener.z,
          ),
        ),
      })),
    };
  };
  useEffect(() => {
    if (!guide) return;
    const timer = setTimeout(
      () => setGuideNow(Date.now()),
      Math.max(0, guide.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [guide]);
  useEffect(() => {
    if (presenting) setGuide(null);
  }, [presenting]);
  const flying =
    flight.phase !== "EDIT" && flight.phase !== "INTERLAP" && !flight.paused;

  const rest = () => {
    audioIntent.current++;
    audio.setMuted(true);
    audio.stop();
    setSoundOn(false);
    setAudioPending(false);
  };
  const toggleSound = async () => {
    if (soundOn) {
      rest();
      return;
    }
    const intent = ++audioIntent.current;
    setAudioPending(true);
    try {
      await audio.enable();
      if (intent !== audioIntent.current) return;
      audio.setMuted(false);
      setSoundOn(true);
      setMessage("音を聴いています。飛行中の旅客機から、音が届きます。");
    } catch {
      if (intent === audioIntent.current)
        setMessage(
          "音を開始できませんでした。「音を聴く」で、もう一度試せます。",
        );
    } finally {
      if (intent === audioIntent.current) setAudioPending(false);
    }
  };
  const start = () => {
    manual.current = false;
    if (experience.paused) experience.togglePause();
    else experience.start();
    setMessage("飛行を始めました。音は「音を聴く」で開始できます。");
  };
  const clear = () => {
    setSelected(null);
    experience.setMix("balanced");
  };
  const controls = controlMenuView(menu, {
    flying,
    flightLabel:
      flight.phase === "COMPILE"
        ? "出発の準備中"
        : flight.phase === "ARRIVAL"
          ? "音の到着を待つ"
          : "飛行中",
    soundOn,
    audioPending,
    volume,
    selected: selected !== null,
    xr: presenting,
    canShowAR: vr.canShowAR,
    ar: xr.displayMode === "ar",
    hands: xr.inputMode === "hands",
    start,
    sound: () => void toggleSound(),
    clear,
    volumeChange: (delta) =>
      setVolume((v) => Math.min(70, Math.max(0, v + delta))),
    environment: () => vr.toggleEnvironment(),
    exit: () => void vr.exit(),
  });
  surface.view = controls;
  vr.controlSurface = surface;
  // Flight and sound keep running while the menu opens, closes or changes page.
  vr.onLocalRest = rest;
  vr.onSelect = setSelected;
  vr.onClear = () => {
    clear();
    menu.close();
  };
  useEffect(() => audio.setVolume(volume / 100), [audio, volume]);
  useEffect(() => {
    experience.onArrival = (arrival, now) => {
      if (soundOn && !document.hidden && vr.canAdvance)
        audio.play(
          arrival,
          now,
          experience.recipe.lowFrequencyGain,
          experience.designFor(arrival.flightId).engineCount,
          experience.designFor(arrival.flightId).sound,
        );
    };
  }, [experience, audio, soundOn, vr]);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const motionChanged = () => menu.set({ reduced: preference.matches });
    const hidden = () => {
      if (document.hidden) rest();
    };
    preference.addEventListener("change", motionChanged);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      audioIntent.current++;
      audio.dispose();
      preference.removeEventListener("change", motionChanged);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [audio, menu]);
  useEffect(() => {
    // A new XR texture needs a first paint even if labels did not change since the last session.
    if (presenting) surface.invalidate();
  }, [presenting, surface]);
  useEffect(() => {
    window.render_game_to_text = () =>
      JSON.stringify({
        ...experience.getSnapshot(),
        mode: "control-components-preview",
        coordinateSystem: "metres; +X east, +Y up, -Z north",
        listener: experience.listener,
        selected,
        audio: {
          on: soundOn,
          pending: audioPending,
          volume,
          state: audio.context?.state ?? "locked",
        },
        controls: {
          ...menu.snapshot,
          title: controls.title,
          actions: [...controls.actions, ...controls.dock].map((a) => ({
            id: a.id,
            label: a.label,
            description: a.description,
            scope: a.scope,
            enabled: !a.disabledReason,
            disabledReason: a.disabledReason,
          })),
        },
        guide: guideView ?? null,
        vr: vr.diagnostics,
      });
    if (import.meta.env.DEV)
      window.advanceTime = async (ms) => {
        if (!Number.isFinite(ms) || ms < 0 || ms > 600000)
          throw new Error("Invalid test time step");
        manual.current = true;
        for (let left = ms; left > 0; left -= Math.min(left, 20))
          experience.advance(Math.min(left, 20));
        experience.notify();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      };
  }, [
    experience,
    audio,
    vr,
    menu,
    menuState,
    controls,
    selected,
    soundOn,
    audioPending,
    volume,
    guideView,
  ]);
  return (
    <main
      className="av-control-lab"
      data-menu-open={menuState.open}
      data-guide-visible={guideVisible}
    >
      <Scene
        experience={experience}
        audio={audio}
        vr={vr}
        soundOn={soundOn}
        view={view}
        manual={manual}
        reduced={false}
        selectedId={selected}
        onSelect={setSelected}
        onClear={clear}
      />
      {!presenting && (
        <>
          <header className="av-lab-header">
            <div>
              <a href="./">AIRPLANEVOICE</a>
              <span>操作部品の試作 · 自分だけの空</span>
            </div>
            <div className="av-lab-header-actions">
              <button type="button" onClick={beginGuide}>
                操作案内を試す
              </button>
              <button
                id="lab-enter"
                onClick={() => void vr.enter(true)}
                disabled={xr.status !== "ready"}
              >
                {xr.status === "entering"
                  ? "空間を開いています…"
                  : "Questで空間に入る"}
              </button>
            </div>
          </header>
          {!flying && !guideVisible && (
            <div className="av-lab-intro">
              <p>空に触れる、小さな操作。</p>
              <span>下の「メニュー」から、飛ばして眺めてみよう。</span>
            </div>
          )}
          {!guideVisible && (
            <p
              className="av-lab-message"
              data-menu-open={menuState.open}
              role="status"
            >
              {xr.error ||
                message ||
                (xr.status === "unsupported"
                  ? "PCではクリックで試せます。Questでは空間に浮かぶ操作盤になります。"
                  : "バーを選ぶとメニューが開きます。閉じると、また空へ。")}
            </p>
          )}
          <ControlDock
            menu={menu}
            view={controls}
            guide={guideView}
            onEndGuide={() => setGuide(null)}
          />
          <AiTrialPanel
            getContext={aiContext}
            disabled={presenting}
            onGuide={(kind) => {
              if (kind === "none") return;
              const now = Date.now();
              setGuideNow(now);
              setGuide(
                beginVolumeGuide(
                  volume,
                  now,
                  kind === "volume-up" ? "up" : "down",
                ),
              );
            }}
          />
        </>
      )}
    </main>
  );
}
