import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Experience,
  OBSERVERS,
  PRESETS,
  presetRoute,
  distance,
  finitePoint,
  type PresetId,
  type RouteSpec,
  validateAircraft,
  aircraftInfo,
  type FlightId,
} from "../../../packages/core/src";
import { AircraftAudio, type OutputProfile } from "./audio";
import { Scene, type ViewState } from "./Scene";
import { RouteEditor } from "./RouteEditor";
import { AirspaceControls } from "./AirspaceControls";
import { Workshop } from "./Workshop";
import { AircraftInfo } from "./AircraftInfo";
import { EvolutionControls } from "./EvolutionControls";
import { ObservationDeck } from "./ObservationDeck";
import { ShowComposer, SHOW_DRAFT_KEY } from "./ShowComposer";
import { VrRuntime } from "./vr";
import { SkyTransfer } from "./SkyTransfer";
import {
  applySky,
  captureSky,
  parseSky,
  skyOptions,
  SKY_OPTIONS_KEY,
  type SkyRecipe,
} from "./sky-transfer";

function Icon({
  name,
  size = 18,
}: {
  name:
    | "plane"
    | "sound"
    | "mute"
    | "play"
    | "pause"
    | "expand"
    | "undo"
    | "arrow"
    | "eye";
  size?: number;
}) {
  const paths = {
    plane: <path d="m21 3-6 18-4-8-8-4 18-6ZM11 13l5-5" />,
    sound: (
      <>
        <path d="m11 4-6 5H2v6h3l6 5V4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
      </>
    ),
    mute: (
      <>
        <path d="m11 4-6 5H2v6h3l6 5V4ZM16 9l6 6m0-6-6 6" />
      </>
    ),
    play: <path d="m8 4 12 8-12 8V4Z" />,
    pause: <path d="M8 5v14M16 5v14" />,
    expand: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
    undo: <path d="m9 5-5 5 5 5M4 10h10a6 6 0 0 1 0 12" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    eye: (
      <>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

const STORAGE_KEY = "sound-trail.desktop.route.v1";
const AIRCRAFT_KEY = "sound-trail.desktop.aircraft.v1";
function loadExperience() {
  const e = new Experience();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const spec = JSON.parse(stored) as RouteSpec;
      if (
        typeof spec.id !== "string" ||
        !Number.isSafeInteger(spec.revision) ||
        spec.closed !== true ||
        !Array.isArray(spec.rawPoints) ||
        spec.rawPoints.length > 1000 ||
        !spec.rawPoints.every(finitePoint)
      )
        throw new Error("Invalid stored route");
      e.setRoute(spec, false);
    }
  } catch {
    /* Storage is optional; a blocked or invalid store uses the preset. */
  }
  try {
    const raw = localStorage.getItem(AIRCRAFT_KEY);
    if (raw) {
      const design = JSON.parse(raw);
      validateAircraft(design);
      e.setAircraftDesign(design);
    }
  } catch {
    /* Aircraft and route recover independently. */
  }
  try {
    const raw = localStorage.getItem(SKY_OPTIONS_KEY);
    if (raw)
      applySky(
        e,
        parseSky({
          ...captureSky(e),
          ...JSON.parse(raw),
          route: e.spec,
          aircraft: e.aircraftDesign,
        }),
        false,
      );
  } catch {
    /* Legacy route and aircraft remain usable if optional settings are invalid. */
  }
  return e;
}

export function App() {
  const [e] = useState(loadExperience);
  const [audio] = useState(() => new AircraftAudio());
  const [vr] = useState(() => new VrRuntime(e, audio));
  const vrState = useSyncExternalStore(vr.subscribe, () => vr.snapshot);
  const snapshot = useSyncExternalStore(e.subscribe, () => e.snapshot);
  const [muted, setMuted] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [volume, setVolume] = useState(35);
  const [outputProfile, setOutputProfile] = useState<OutputProfile>(
    audio.outputProfile,
  );
  const [delay, setDelay] = useState(e.recipe.delayScale);
  const [observer, setObserver] = useState<string>(
    () =>
      OBSERVERS.find((o) => distance(o.position, e.listener) < 1)?.id ??
      "garden",
  );
  const [transfer, setTransfer] = useState<{ code?: string } | null>(null);
  useEffect(() => {
    const receive = () => {
      if (location.hash.startsWith("#sky="))
        setTransfer({ code: location.hash.slice(5) });
    };
    receive();
    window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, []);
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [zoom, setZoom] = useState(false);
  const [message, setMessage] = useState("");
  const [help, setHelp] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const [workshop, setWorkshop] = useState(false);
  const [showEditor, setShowEditor] = useState(!!e.show);
  const [composerRevision, setComposerRevision] = useState(0);
  const [offlineReady, setOfflineReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [inspectedId, setInspectedId] = useState<FlightId | null>(null);
  const view = useRef<ViewState>({ yaw: 0, pitch: 0.32, zoom: false });
  const manual = useRef(false);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editing = snapshot.phase === "EDIT";
  const interlap = snapshot.phase === "INTERLAP";
  const active = !editing && !interlap;
  const inspection = inspectedId ? aircraftInfo(e, inspectedId) : null;
  useEffect(() => {
    if (inspectedId && !e.flightIds.includes(inspectedId)) setInspectedId(null);
  }, [e, inspectedId, snapshot.airspace.aircraftCount]);
  function lookAtAircraft(id: FlightId) {
    if (!aircraftInfo(e, id)?.visible) return;
    const p = e.pose(id).position;
    const x = p.x - e.listener.x,
      y = p.y - e.listener.y,
      z = p.z - e.listener.z;
    view.current.yaw = Math.atan2(-x, -z);
    view.current.pitch = Math.atan2(y, Math.hypot(x, z));
  }

  const notifyMessage = useCallback((text: string) => {
    setMessage(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(""), 6000);
  }, []);
  const save = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(e.spec));
      localStorage.setItem(AIRCRAFT_KEY, JSON.stringify(e.aircraftDesign));
    } catch {
      notifyMessage(
        "このブラウザでは航路を保存できません。今の画面では続けられます。",
      );
    }
  }, [e, notifyMessage]);
  useEffect(() => {
    try {
      localStorage.setItem(
        SKY_OPTIONS_KEY,
        JSON.stringify({
          version: e.show ? 2 : 1,
          ...(e.show ? { show: e.show } : {}),
          airspace: e.airspace,
          evolution: e.evolution,
          delayScale: delay,
          observer,
        }),
      );
    } catch {
      /* Optional storage: importing and playing still work for this visit. */
    }
  }, [
    e,
    snapshot.airspace.aircraftCount,
    snapshot.airspace.spacingSec,
    snapshot.evolution.enabled,
    snapshot.evolution.amount,
    snapshot.show,
    delay,
    observer,
  ]);
  function closeTransfer() {
    setTransfer(null);
    if (location.hash.startsWith("#sky="))
      history.replaceState(null, "", location.pathname + location.search);
  }
  function importSky(sky: SkyRecipe) {
    applySky(e, sky);
    setDelay(sky.delayScale);
    setObserver(sky.observer);
    setInspectedId(null);
    setWorkshop(false);
    setShowEditor(!!sky.show);
    setComposerRevision((n) => n + 1);
    view.current = { yaw: 0, pitch: 0.32, zoom: false };
    setZoom(false);
    closeTransfer();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(e.spec));
      localStorage.setItem(AIRCRAFT_KEY, JSON.stringify(e.aircraftDesign));
      localStorage.setItem(SKY_OPTIONS_KEY, JSON.stringify(skyOptions(sky)));
      notifyMessage(
        "この空を取り込みました。飛ばすか、VRで空に立ってみましょう。",
      );
    } catch {
      notifyMessage("この空を取り込みました。端末への保存はできませんでした。");
    }
  }

  async function enableAudio() {
    try {
      await audio.enable();
      setAudioReady(true);
      return true;
    } catch {
      notifyMessage("音を開始できませんでした。音ボタンでもう一度試せます。");
      return false;
    }
  }
  async function play(next = false) {
    const ready = enableAudio();
    e.start(delay, next);
    audio.setMuted(muted);
    setMessage("");
    await ready;
  }
  function edit() {
    audio.stop();
    setInspectedId(null);
    e.edit();
  }
  function keepRoute() {
    audio.stop();
    setInspectedId(null);
    e.edit(true);
    save();
    notifyMessage("この周回の航路を残しました。編集して、また飛ばせます。");
  }
  function pause() {
    e.togglePause();
    if (e.paused) audio.stop();
    else void enableAudio();
  }
  async function sound() {
    if (!audioReady) {
      if (await enableAudio()) {
        setMuted(false);
        audio.setMuted(false);
      }
      return;
    }
    setMuted(!muted);
    audio.setMuted(!muted);
  }
  vr.onPrimary = () => {
    if (e.paused) pause();
    else if (
      e.phase === "EDIT" ||
      (e.phase === "INTERLAP" && !e.evolution.enabled)
    )
      void play(e.phase === "INTERLAP");
    else pause();
  };
  vr.onSound = () => {
    void sound();
  };
  vr.onSelect = setInspectedId;
  function clearSelection() {
    setInspectedId(null);
    e.setMix("balanced");
  }
  vr.onClear = clearSelection;
  function changeVolume(value: number) {
    const next = Math.max(0, Math.min(70, value));
    setVolume(next);
    audio.setVolume(next / 100);
  }
  function changeProfile(value: OutputProfile) {
    setOutputProfile(value);
    audio.setOutputProfile(value);
  }
  vr.onVolume = (delta) => changeVolume(volume + delta);
  vr.onProfile = () =>
    changeProfile(outputProfile === "speaker" ? "headphones" : "speaker");
  function enterVr() {
    void vr.enter();
    void enableAudio();
  }
  function reset() {
    audio.stop();
    e.reset();
    setWorkshop(false);
    setShowEditor(false);
    setComposerRevision((n) => n + 1);
    try {
      localStorage.removeItem(SHOW_DRAFT_KEY);
    } catch {
      /* Optional storage. */
    }
    setInspectedId(null);
    setObserver("garden");
    setDelay(1.6);
    setZoom(false);
    view.current = { yaw: 0, pitch: 0.32, zoom: false };
    save();
    notifyMessage("最初の空と航路に戻しました。");
  }
  function fullscreen() {
    const task = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    void task.catch(() =>
      notifyMessage("この画面では全画面表示を利用できません。"),
    );
  }
  function exportLogs() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: "0.10.0",
            platform: vr.diagnostics.frames > 0 ? "webxr-standalone" : "web",
            route: e.spec,
            aircraftDesign: e.aircraftDesign,
            recipe: e.recipe,
            airspace: e.airspace,
            listening: {
              mode: e.mixMode,
              focusId: e.focusId,
              gains: e.mixGains,
            },
            tower: { enabled: e.tower.enabled, provider: "local-rules" },
            audio: {
              state: audio.context?.state ?? "locked",
              activeByFlight: audio.activeByFlight,
              played: audio.played,
              skipped: audio.skipped,
              playedByFlight: audio.playedByFlight,
              outputProfile: audio.outputProfile,
              volume: audio.volumeLevel,
              levels: audio.levels,
            },
            events: e.logs,
            vr: vr.diagnostics,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = "sound-trail-session.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  useEffect(() => {
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    let live = true;
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`)
        .then(() => navigator.serviceWorker.ready)
        .then(() => {
          if (live) setOfflineReady(true);
        })
        .catch(() => {
          /* Optional cache; normal online play remains available. */
        });
    }
    return () => {
      live = false;
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, []);
  useEffect(() => {
    audio.setMix(e.mixGains);
  }, [
    audio,
    e,
    snapshot.mixMode,
    snapshot.focusId,
    snapshot.airspace.aircraftCount,
  ]);
  useEffect(() => {
    e.onArrival = (arrival, now) =>
      audio.play(
        arrival,
        now,
        e.recipe.lowFrequencyGain,
        e.designFor(arrival.flightId).engineCount,
      );
    window.render_game_to_text = () =>
      JSON.stringify({
        ...e.getSnapshot(),
        coordinateSystem:
          "meters, +X right/east, +Y up, -Z forward/north; origin at meadow observer",
        routeId: e.spec.id,
        routePoints: e.spec.rawPoints.length,
        generator: e.spec.generator ?? null,
        flightSettings: e.spec.flight ?? null,
        listener: e.listener,
        aircraft: e.pose(),
        designLineVisible: e.phase === "EDIT",
        recipe: e.recipe,
        audio: {
          state: audio.context?.state ?? "locked",
          muted,
          played: audio.played,
          skipped: audio.skipped,
          activeVoices: audio.activeVoices,
          activeByFlight: audio.activeByFlight,
          outputProfile: audio.outputProfile,
          volume: audio.volumeLevel,
          levels: audio.levels,
          playedByFlight: audio.playedByFlight,
          mixGains: audio.mixGains,
          busLevels: audio.busLevels,
          listener: audio.listenerPose,
        },
        render: window.__soundTrailRender,
        vr: vr.diagnostics,
        view: view.current,
        offline: { ready: offlineReady, online },
        inspection: inspectedId ? aircraftInfo(e, inspectedId) : null,
        aircraftTargets: window.__soundTrailTargets ?? [],
      });
    if (import.meta.env.DEV)
      window.advanceTime = async (ms: number) => {
        if (!Number.isFinite(ms) || ms < 0 || ms > 600000)
          throw new Error("Invalid test time step");
        manual.current = true;
        for (let left = ms; left > 0; left -= Math.min(20, left))
          e.advance(Math.min(20, left));
        e.notify();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      };
  }, [e, audio, vr, muted, offlineReady, online, inspectedId]);
  useEffect(() => {
    function onHidden() {
      if (document.hidden && !vr.active && e.phase !== "EDIT" && !e.paused) {
        e.togglePause();
        audio.stop();
      }
    }
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      audio.dispose();
      if (messageTimer.current) clearTimeout(messageTimer.current);
    };
  }, [e, audio, vr]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (vr.active || transfer) return;
      if (event.key === "Escape" && inspectedId && !help) {
        event.preventDefault();
        setInspectedId(null);
        return;
      }
      const element = event.target as HTMLElement;
      if (element.closest("input, select, textarea, button") || event.repeat)
        return;
      if (event.key === "Enter" && (editing || interlap)) {
        event.preventDefault();
        void play(interlap);
      }
      if (event.code === "Space" && !editing) {
        event.preventDefault();
        pause();
      }
      if (event.key === "Escape") {
        setHelp(false);
        if (active) edit();
      }
      if (event.key.toLowerCase() === "f") fullscreen();
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const phaseLabel = {
    EDIT: "航路を描く",
    COMPILE: "手を止めて、空へ",
    FLY: "飛行を眺める",
    ARRIVAL: "残る音を待つ",
    INTERLAP: "ひと巡りの、余韻",
  }[snapshot.phase];
  const altitude = Math.round(
    e.spec.rawPoints.reduce((sum, p) => sum + p.y / e.spec.rawPoints.length, 0),
  );

  return (
    <main
      className={`app ${editing ? "is-editing" : "is-flying"} ${e.airspace.aircraftCount > 1 ? "has-fleet" : ""} ${editing && (workshop || showEditor) ? "is-workshop" : ""}`}
    >
      <header className="topbar">
        <a className="brand" href="./" aria-label="音航跡 ホーム">
          <span className="brand-mark">
            <Icon name="plane" size={23} />
          </span>
          <span>
            音航跡 <span className="brand-en">SOUND TRAIL</span>
          </span>
        </a>
        <div className="top-actions">
          <a
            className="quiet-button"
            href={
              location.hostname === "tom7x7.github.io"
                ? "https://airplanevoice-shared-sky.tomohaya-falcon-aramaki.workers.dev/?shared=1"
                : "?shared=1"
            }
          >
            一緒に飛ばす
          </a>
          <span className="edition">
            SKY WORKSHOP <span>03</span>
          </span>
          <button
            className="quiet-button"
            onClick={() => setHelp(!help)}
            aria-expanded={help}
          >
            遊び方
          </button>
          <button
            className="icon-button"
            aria-label="全画面表示を切り替え"
            onClick={fullscreen}
          >
            <Icon name="expand" />
          </button>
        </div>
      </header>
      <section className="workspace">
        <aside className="sidebar" aria-label="航路と飛行の設定">
          <div className="sidebar-scroll">
            <div className="sidebar-heading">
              <span className="eyebrow">A LITTLE LINE, A WIDE OPEN SKY</span>
              <h1>
                空に、ひとつの
                <br />
                路線を。
              </h1>
              <p>
                描いて、眺めて。
                <br />
                あとの音まで、待ってみる。
              </p>
            </div>
            {editing && !showEditor && (
              <button
                className="workshop-toggle"
                aria-expanded={workshop}
                onClick={() => {
                  e.clearShow();
                  setShowEditor(false);
                  setWorkshop(!workshop);
                  save();
                }}
              >
                {workshop ? "← 自由に線を描く" : "つくる実験室 →"}
              </button>
            )}
            {editing && (
              <button
                className="workshop-toggle"
                aria-expanded={showEditor}
                onClick={() => {
                  if (showEditor) {
                    e.clearShow();
                    save();
                  }
                  setShowEditor(!showEditor);
                  setWorkshop(false);
                }}
              >
                {showEditor ? "← 単体の航路へ" : "演目をつくる →"}
              </button>
            )}
            {(!editing || !showEditor) && <AirspaceControls experience={e} />}
            {(!editing || !showEditor) && <EvolutionControls experience={e} />}
            {editing && (
              <button
                className="transfer-open secondary"
                onClick={() => setTransfer({})}
              >
                この空をQuestへ渡す
              </button>
            )}
            <section className="vr-entry" aria-label="QuestでのVR体験">
              <button
                id="vr-enter"
                className="secondary"
                disabled={
                  vrState.status !== "ready" && vrState.status !== "presenting"
                }
                onClick={() =>
                  vrState.status === "presenting" ? void vr.exit() : enterVr()
                }
              >
                {vrState.status === "presenting"
                  ? "VRを終了"
                  : vrState.status === "entering"
                    ? "VRに入っています…"
                    : "VRで空に立つ"}
              </button>
              <p>
                {vrState.status === "unsupported"
                  ? "QuestのブラウザでこのURLを開くと、VRで試せます。"
                  : "1人用VR試作 · コントローラーで選択・開始"}
              </p>
              {vrState.error && <p role="alert">{vrState.error}</p>}
            </section>
            {editing ? (
              showEditor ? (
                <ShowComposer
                  key={composerRevision}
                  experience={e}
                  onSave={save}
                  onInspect={(id) => {
                    lookAtAircraft(id);
                    view.current.zoom = true;
                    setZoom(true);
                  }}
                />
              ) : workshop ? (
                <Workshop
                  experience={e}
                  onSave={save}
                  onInspect={() => {
                    const p = e.pose().position,
                      x = p.x - e.listener.x,
                      y = p.y - e.listener.y,
                      z = p.z - e.listener.z;
                    view.current.yaw = Math.atan2(-x, -z);
                    view.current.pitch = Math.atan2(y, Math.hypot(x, z));
                    view.current.zoom = true;
                    setZoom(true);
                  }}
                />
              ) : (
                <>
                  <div className="section-label">
                    <span>01</span>
                    <h2>飛び方を選ぶ</h2>
                  </div>
                  <div className="preset-list">
                    {PRESETS.map((p) => (
                      <button
                        key={p.id}
                        className={`preset ${e.spec.id === p.id ? "chosen" : ""}`}
                        onClick={() => {
                          e.setRoute(
                            presetRoute(
                              p.id as PresetId,
                              e.spec.revision + 1,
                              altitude,
                            ),
                          );
                          save();
                        }}
                        aria-pressed={e.spec.id === p.id}
                      >
                        <svg viewBox="0 0 52 35" aria-hidden="true">
                          <path
                            d={
                              p.id === "eight"
                                ? "M26 18C6-9-9 35 15 27L37 8C62-7 61 45 26 18Z"
                                : p.id === "rise"
                                  ? "M4 25C12 8 22 26 28 13S47 4 47 15 29 34 4 25Z"
                                  : "M5 19C5 0 47 0 47 19S5 39 5 19Z"
                            }
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.4"
                          />
                        </svg>
                        <span>
                          <strong>{p.name}</strong>
                          <small>{p.caption}</small>
                        </span>
                        <span className="preset-number">{p.number}</span>
                      </button>
                    ))}
                  </div>
                  <div className="section-label edit-label">
                    <span>02</span>
                    <h2>線を少し、変えてみる</h2>
                    <button
                      className="icon-button"
                      aria-label="元に戻す"
                      disabled={!e.canUndo}
                      onClick={() => {
                        e.undo();
                        save();
                      }}
                    >
                      <Icon name="undo" size={15} />
                    </button>
                  </div>
                  <RouteEditor
                    experience={e}
                    onChange={save}
                    onError={notifyMessage}
                  />
                  <label className="range-label">
                    空の高さ{" "}
                    <span>
                      {altitude} <small>m</small>
                    </span>
                    <input
                      aria-label="空の高さ"
                      type="range"
                      min="140"
                      max="440"
                      step="20"
                      value={altitude}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        e.setRoute({
                          ...e.spec,
                          revision: e.spec.revision + 1,
                          generator: e.spec.generator
                            ? { ...e.spec.generator, altitudeM: value }
                            : undefined,
                          rawPoints: e.spec.rawPoints.map((p) => ({
                            ...p,
                            y: value + (p.y - altitude),
                          })),
                        });
                        save();
                      }}
                    />
                  </label>
                  {e.route.notices.map((text) => (
                    <p className="route-notice" key={text}>
                      {text}
                    </p>
                  ))}
                </>
              )
            ) : (
              <div className="flight-sidebar">
                <div className="section-label">
                  <span>0{Math.min(3, snapshot.lap + 1)}</span>
                  <h2>{phaseLabel}</h2>
                </div>
                <div className="flight-diagram">
                  <ObservationDeck experience={e} />
                </div>
                <p className="flight-thought">
                  {snapshot.phase === "COMPILE"
                    ? "線を手放すと、\n空は飛行機のものになる。"
                    : interlap
                      ? snapshot.evolution.enabled
                        ? "少し違う空へ。\n次の飛行を待つ。"
                        : "今の空を、\nもう一度見てみよう。"
                      : "姿は、先へ。\n音は、あとから。"}
                </p>
                <p className="flight-explain">
                  {interlap
                    ? snapshot.evolution.enabled
                      ? "同じ航路をもとに、\n旋回と起伏を少しずつ変えて。"
                      : snapshot.lap % 2 === 0
                        ? "次の一周は、低い響きを少しだけ深く。"
                        : "次の一周は、最初の響きに戻ります。"
                    : "空をドラッグして見回せます。\n目のボタンで、少し近くに。"}
                </p>
              </div>
            )}
          </div>
          {!editing && (
            <div className="flight-controls">
              {interlap && !snapshot.evolution.enabled && !snapshot.paused ? (
                <button className="primary" onClick={() => void play(true)}>
                  <Icon name="play" size={16} />
                  <span>もう一周、眺める</span>
                </button>
              ) : (
                <button className="secondary" onClick={pause}>
                  <Icon name={snapshot.paused ? "play" : "pause"} size={16} />
                  {snapshot.paused ? "飛行を再開" : "ひと休み"}
                </button>
              )}
              {snapshot.evolution.changed && (
                <button className="text-button keep-route" onClick={keepRoute}>
                  この航路を残して編集 <Icon name="arrow" size={14} />
                </button>
              )}
              <button className="text-button" onClick={edit}>
                航路を描き直す <Icon name="arrow" size={14} />
              </button>
            </div>
          )}
          {editing && (
            <div className="launch-controls">
              <button
                id="start-btn"
                className="primary"
                onClick={() => void play()}
              >
                <Icon name="play" size={16} />
                <span>{e.show ? "この演目で飛ばす" : "この航路で飛ばす"}</span>
                <span className="keycap">↵</span>
              </button>
              <p className="start-note">
                飛行 約{Math.round(e.durationMs / 1000)}秒 · ヘッドホン推奨
              </p>
            </div>
          )}
          <div className="sidebar-footer">
            <span className="status-dot" />
            {online ? "ひとりで、空を観察中" : "オフラインで観察中"}
            <button onClick={reset}>リセット</button>
          </div>
        </aside>
        <div className="viewport">
          <div className="sky-stage">
            <Scene
              experience={e}
              audio={audio}
              vr={vr}
              soundOn={audioReady && !muted}
              view={view}
              manual={manual}
              reduced={reduced}
              selectedId={inspectedId}
              onSelect={setInspectedId}
              onClear={clearSelection}
            />
            <div className="sky-top">
              <span className="sky-label">
                <span className="status-dot" />
                CLEAR MORNING <span>快晴の朝</span>
              </span>
              <div className="sky-controls">
                <button
                  className={`glass-button info-toggle ${inspection ? "on" : ""}`}
                  aria-label="機体情報を表示"
                  aria-expanded={!!inspection}
                  onClick={() => setInspectedId(inspection ? null : "ST-01")}
                >
                  <Icon name="plane" />
                  <span>機体情報</span>
                </button>
                <button
                  className={`glass-button ${zoom ? "on" : ""}`}
                  aria-label="遠くを見る"
                  aria-pressed={zoom}
                  onClick={() => {
                    setZoom(!zoom);
                    view.current.zoom = !zoom;
                  }}
                >
                  <Icon name="eye" />
                </button>
                <button
                  className="glass-button sound-button"
                  onClick={() => void sound()}
                  aria-label="音声を切り替え"
                  aria-pressed={audioReady && !muted}
                >
                  <Icon name={muted || !audioReady ? "mute" : "sound"} />
                  <span>
                    {!audioReady ? "音をオン" : muted ? "消音中" : "音あり"}
                  </span>
                </button>
              </div>
            </div>
            {editing && (
              <div className="sky-caption">
                <span>OBSERVATION FIELD</span>
                <h2>あの音が届くまで。</h2>
                <p>
                  {e.airspace.aircraftCount === 1
                    ? "一機の飛行機と、あなたの空。"
                    : "いくつもの響きが行き交う、あなたの空。"}
                </p>
              </div>
            )}
            {snapshot.phase === "COMPILE" && (
              <div className="countdown" role="status">
                <span>{Math.ceil(snapshot.countdownSec)}</span>
                <p>空を見上げよう。</p>
              </div>
            )}
            {snapshot.paused && (
              <div className="pause-overlay">
                <span>ひと休み</span>
                <button onClick={pause}>飛行を再開する</button>
              </div>
            )}
            <div
              className="tower-caption"
              aria-live="polite"
              aria-atomic="true"
            >
              {!snapshot.paused && snapshot.towerCue && (
                <div>
                  <span>管制案内</span>
                  <p>{snapshot.towerCue.text}</p>
                </div>
              )}
            </div>
            <div className="horizon-note">
              {e.route.speedMps} m/s <span>／</span>{" "}
              {e.aircraftDesign.engineCount} ENGINES <span>／</span> ONE OPEN
              SKY
            </div>
            <div className="view-bottom">
              <div className="observer-control">
                <span>眺める場所</span>
                <div>
                  {OBSERVERS.map((o) => (
                    <button
                      key={o.id}
                      disabled={active}
                      className={observer === o.id ? "selected" : ""}
                      onClick={() => {
                        setObserver(o.id);
                        e.setListener(o.position);
                      }}
                      aria-pressed={observer === o.id}
                    >
                      {o.name}
                    </button>
                  ))}
                </div>
              </div>
              <button
                className="view-reset"
                onClick={() => {
                  view.current.yaw = 0;
                  view.current.pitch = 0.32;
                }}
              >
                正面を向く ↗
              </button>
            </div>
            {!editing && (
              <div className="flight-progress">
                <span>{snapshot.paused ? "PAUSED" : phaseLabel}</span>
                <div>
                  <i style={{ width: `${snapshot.progress * 100}%` }} />
                </div>
                <span>
                  {Math.min(
                    Math.round(snapshot.elapsedMs / 1000),
                    Math.round(snapshot.durationMs / 1000),
                  )}{" "}
                  s
                </span>
              </div>
            )}
            {message && (
              <div className="toast" role="status">
                {message}
              </div>
            )}
          </div>
          {inspection && (
            <AircraftInfo
              info={inspection}
              ids={e.flightIds}
              onSelect={setInspectedId}
              onClose={() => setInspectedId(null)}
              onClear={clearSelection}
              onLook={() => lookAtAircraft(inspection.id)}
            />
          )}
        </div>
      </section>
      <footer className="bottombar">
        <span>DRAW A ROUTE. LET THE SKY ANSWER.</span>
        <button
          onClick={() => setDiagnostics(!diagnostics)}
          aria-expanded={diagnostics}
        >
          音・表示の設定 <span>{diagnostics ? "−" : "+"}</span>
        </button>
        <span className="version">WORKSHOP · v0.10.0</span>
      </footer>
      {transfer && (
        <SkyTransfer
          experience={e}
          delay={delay}
          observer={observer}
          code={transfer.code}
          onApply={importSky}
          onClose={closeTransfer}
        />
      )}
      {diagnostics && (
        <section className="settings" aria-label="音と表示の設定">
          <div>
            <h2>音と表示</h2>
            <label className="spacing-label">
              音の聴き方に合わせる
              <select
                aria-label="音の出力に合わせる"
                value={outputProfile}
                onChange={(event) =>
                  changeProfile(event.target.value as OutputProfile)
                }
              >
                <option value="speaker">本体スピーカー向け</option>
                <option value="headphones">ヘッドホン向け</option>
              </select>
            </label>
            <label className="range-label">
              音量 <span>{volume}%</span>
              <input
                aria-label="音量"
                type="range"
                min="0"
                max="70"
                value={volume}
                onChange={(event) => {
                  const v = Number(event.target.value);
                  changeVolume(v);
                }}
              />
            </label>
            <label className="range-label">
              音の遅れの演出 <span>×{delay.toFixed(1)}</span>
              <input
                aria-label="音の遅れの演出"
                type="range"
                min="1"
                max="3"
                step="0.1"
                disabled={active}
                value={delay}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setDelay(value);
                  e.recipe = { ...e.recipe, delayScale: value };
                  e.notify();
                }}
              />
            </label>
            <small>×1 は音速343 m/s。倍率は次の飛行に反映。</small>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={reduced}
                onChange={(event) => setReduced(event.target.checked)}
              />
              到来波の表示を控えめにする
            </label>
          </div>
          <div>
            <h2>試作の観測値</h2>
            <div className="audio-levels" aria-label="各機体の音の信号">
              {e.flightIds.map((id) => {
                const level = audio.levels.flights[id];
                const hasSignal =
                  audio.context?.state === "running" &&
                  !muted &&
                  volume > 0 &&
                  !snapshot.paused &&
                  (level?.rms ?? 0) > 0.0001;
                const arrived =
                  snapshot.fleet.find((f) => f.id === id)?.arrivedCount ?? 0;
                return (
                  <div key={id}>
                    <span>{id}</span>
                    <meter
                      aria-label={`${id}の音の信号`}
                      min={-70}
                      max={-10}
                      value={hasSignal ? level!.db : -70}
                    />
                    <small>
                      {hasSignal
                        ? "信号あり"
                        : arrived === 0
                          ? "到来待ち"
                          : "信号なし"}
                    </small>
                  </div>
                );
              })}
              <p>
                アプリ内部の音の信号です。機体が見えてから音が届くまで間があります。本体の音量や実際の聞こえ方は、この表示には含みません。
              </p>
            </div>
            <dl>
              <dt>機体まで</dt>
              <dd>{Math.round(distance(e.pose().position, e.listener))} m</dd>
              <dt>直近の音の遅れ</dt>
              <dd>
                {snapshot.latestDelaySec === null
                  ? "—"
                  : `${snapshot.latestDelaySec.toFixed(2)} 秒`}
              </dd>
              <dt>到来した音</dt>
              <dd>{snapshot.arrivedCount}</dd>
              <dt>経路チェックサム</dt>
              <dd>{snapshot.checksum}</dd>
              <dt>直近VRのフレーム間隔 p95</dt>
              <dd>{vr.diagnostics.frameMsP95?.toFixed(1) ?? "—"} ms</dd>
            </dl>
            <p>
              この版はPC・Questで一人用の試作です。最大3機で聴き比べられます。管制字幕はPC上の定型案内で、AIは未接続です。Quest実機の快適性・複数端末での共有は未確認です。
            </p>
            <p>
              {offlineReady
                ? "この端末に単体体験を保存しました。通信が切れても、再読み込みして遊べます。"
                : import.meta.env.DEV
                  ? "開発環境ではオフライン保存を使いません。配布版で確認できます。"
                  : "オフラインで使うための準備中です。"}
            </p>
            <button className="text-button" onClick={exportLogs}>
              この体験のログを保存 <Icon name="arrow" size={14} />
            </button>
          </div>
        </section>
      )}
      {help && (
        <div className="help-backdrop" onClick={() => setHelp(false)}>
          <section
            className="help"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="eyebrow">HOW TO SPEND A LITTLE TIME HERE</span>
            <h2 id="help-title">描いたあとは、空を見よう。</h2>
            <ol>
              <li>
                <strong>航路を選ぶ、線を描く。</strong>
                <span>
                  3つの飛び方から選び、点をドラッグ。自分で一筆描くこともできます。
                </span>
              </li>
              <li>
                <strong>飛行機を眺める。</strong>
                <span>
                  「飛ばす」を押すと、線は消えます。空をドラッグして見回し、目のボタンで拡大。機体を押すと速度・進行方向が見られます。右上の「機体情報」からも選べます。
                </span>
              </li>
              <li>
                <strong>あとから届く音を待つ。</strong>
                <span>
                  過去の場所から音が届き、薄い航跡が浮かびます。もう一周、場所を変えて比べてみてください。
                </span>
              </li>
            </ol>
            <p className="help-keys">
              Enter 飛行開始 · Space ひと休み · Esc 編集へ · F 全画面
            </p>
            <p>
              Questでは「VRで空に立つ」から入場。操作盤や機体を指してトリガーで選びます。グリップで操作盤を正面に呼べます。ヘッドセットを外した後は、操作盤から飛行を再開します。
            </p>
            <button
              className="primary"
              autoFocus
              onClick={() => setHelp(false)}
            >
              空に戻る <Icon name="arrow" />
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
