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
} from "../../../packages/core/src";
import { AircraftAudio } from "./audio";
import { Scene, type ViewState } from "./Scene";
import { RouteEditor } from "./RouteEditor";

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
  return e;
}

export function App() {
  const [e] = useState(loadExperience);
  const [audio] = useState(() => new AircraftAudio());
  const snapshot = useSyncExternalStore(e.subscribe, () => e.snapshot);
  const [muted, setMuted] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [volume, setVolume] = useState(35);
  const [delay, setDelay] = useState(1.6);
  const [observer, setObserver] = useState<string>("garden");
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [zoom, setZoom] = useState(false);
  const [message, setMessage] = useState("");
  const [help, setHelp] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const view = useRef<ViewState>({ yaw: 0, pitch: 0.32, zoom: false });
  const manual = useRef(false);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editing = snapshot.phase === "EDIT";
  const interlap = snapshot.phase === "INTERLAP";
  const active = !editing && !interlap;

  const notifyMessage = useCallback((text: string) => {
    setMessage(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(""), 6000);
  }, []);
  const save = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(e.spec));
    } catch {
      notifyMessage(
        "このブラウザでは航路を保存できません。今の画面では続けられます。",
      );
    }
  }, [e, notifyMessage]);

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
    e.edit();
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
  function reset() {
    audio.stop();
    e.reset();
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
            version: "0.1.0",
            platform: "desktop-local",
            route: e.spec,
            recipe: e.recipe,
            audio: { played: audio.played, skipped: audio.skipped },
            events: e.logs,
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
    e.onArrival = (arrival, now) =>
      audio.play(arrival, now, e.recipe.lowFrequencyGain);
    window.render_game_to_text = () =>
      JSON.stringify({
        ...e.getSnapshot(),
        coordinateSystem:
          "meters, +X right/east, +Y up, -Z forward/north; origin at meadow observer",
        routeId: e.spec.id,
        routePoints: e.spec.rawPoints.length,
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
        },
        render: window.__soundTrailRender,
        view: view.current,
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
  }, [e, audio, muted]);
  useEffect(() => {
    function onHidden() {
      if (
        document.hidden &&
        ["FLY", "ARRIVAL", "COMPILE"].includes(e.phase) &&
        !e.paused
      ) {
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
  }, [e, audio]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      const element = event.target as HTMLElement;
      if (element.closest("input, select, textarea, button") || event.repeat)
        return;
      if (event.key === "Enter" && (editing || interlap)) {
        event.preventDefault();
        void play(interlap);
      }
      if (event.code === "Space" && active) {
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
    <main className={`app ${editing ? "is-editing" : "is-flying"}`}>
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
          <span className="edition">
            DESKTOP STUDY <span>01</span>
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
            {editing ? (
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
            ) : (
              <div className="flight-sidebar">
                <div className="section-label">
                  <span>0{Math.min(3, snapshot.lap + 1)}</span>
                  <h2>{phaseLabel}</h2>
                </div>
                <div className="flight-diagram">
                  <svg viewBox="0 0 220 180" aria-hidden="true">
                    <ellipse
                      cx="110"
                      cy="85"
                      rx="89"
                      ry="55"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="0.8"
                      strokeDasharray="3 6"
                    />
                    <path d="m166 45 18 5-17 7 3-6z" fill="currentColor" />
                    <path
                      d="M80 139q30-23 60 0M88 149q22-17 44 0M98 159q12-9 24 0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1"
                    />
                  </svg>
                </div>
                <p className="flight-thought">
                  {snapshot.phase === "COMPILE"
                    ? "線を手放すと、\n空は飛行機のものになる。"
                    : interlap
                      ? "今の空を、\nもう一度見てみよう。"
                      : "姿は、先へ。\n音は、あとから。"}
                </p>
                <p className="flight-explain">
                  {interlap
                    ? snapshot.lap % 2 === 0
                      ? "次の一周は、低い響きを少しだけ深く。"
                      : "次の一周は、最初の響きに戻ります。"
                    : "空をドラッグして見回せます。\n目のボタンで、少し近くに。"}
                </p>
                {interlap ? (
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
                <button className="text-button" onClick={edit}>
                  航路を描き直す <Icon name="arrow" size={14} />
                </button>
              </div>
            )}
          </div>
          {editing && (
            <div className="launch-controls">
              <button
                id="start-btn"
                className="primary"
                onClick={() => void play()}
              >
                <Icon name="play" size={16} />
                <span>この航路で飛ばす</span>
                <span className="keycap">↵</span>
              </button>
              <p className="start-note">
                一周 約{Math.round(e.route.durationMs / 1000)}秒 ·
                ヘッドホン推奨
              </p>
            </div>
          )}
          <div className="sidebar-footer">
            <span className="status-dot" />
            ひとりで、空を観察中<button onClick={reset}>リセット</button>
          </div>
        </aside>
        <div className="viewport">
          <Scene
            experience={e}
            audio={audio}
            view={view}
            manual={manual}
            reduced={reduced}
          />
          <div className="sky-top">
            <span className="sky-label">
              <span className="status-dot" />
              CLEAR MORNING <span>快晴の朝</span>
            </span>
            <div className="sky-controls">
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
              <p>一機の飛行機と、あなたの空。</p>
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
          <div className="horizon-note">
            58 m/s <span>／</span> FOUR ENGINES <span>／</span> ONE OPEN SKY
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
      </section>
      <footer className="bottombar">
        <span>DRAW A ROUTE. LET THE SKY ANSWER.</span>
        <button
          onClick={() => setDiagnostics(!diagnostics)}
          aria-expanded={diagnostics}
        >
          音・表示の設定 <span>{diagnostics ? "−" : "+"}</span>
        </button>
        <span className="version">S0 · v0.1</span>
      </footer>
      {diagnostics && (
        <section className="settings" aria-label="音と表示の設定">
          <div>
            <h2>音と表示</h2>
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
                  setVolume(v);
                  audio.setVolume(v / 100);
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
                onChange={(event) => setDelay(Number(event.target.value))}
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
            </dl>
            <p>
              この版はPCでの一人用試作です。機体・合成音は検証用。Questと二人同期は今後の段階です。
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
                  「飛ばす」を押すと、線は消えます。空をドラッグして見回し、目のボタンで拡大できます。
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
