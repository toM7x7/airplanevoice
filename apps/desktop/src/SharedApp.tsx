import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AIRCRAFT_PATTERNS,
  aircraftInfo,
  DEFAULT_WORKSHOP,
  Experience,
  ROUTE_PATTERNS,
  type FlightId,
  type WorkshopRecipe,
} from "../../../packages/core/src";
import { checkedWorkshop } from "../../../packages/core/src/shared-room";
import { SharedPlayback } from "../../../packages/core/src/shared-playback";
import { RoomClient } from "./room-client";
import { AircraftAudio } from "./audio";
import { VrRuntime } from "./vr";
import { sharedPanel, type SharedPage } from "./shared-panel";
import { RoomInvite } from "./RoomInvite";
import { RoomSpeech, type SpeechOutput } from "./room-speech";
import { RoomTower } from "./RoomTower";
import {
  observeRoom,
  describeRoom,
} from "../../../packages/core/src/room-observation";
import { Scene, type ViewState } from "./Scene";
import { AnchorMap } from "./Workshop";
import { AircraftInfo } from "./AircraftInfo";
import "./shared.css";

export function SharedApp() {
  const [e] = useState(() => new Experience());
  const [audio] = useState(() => new AircraftAudio());
  const [vr] = useState(() => new VrRuntime(e, audio));
  const [client] = useState(() => new RoomClient());
  const [speech] = useState<SpeechOutput>(() => new RoomSpeech());
  const speechState = useSyncExternalStore(
    speech.subscribe,
    () => speech.snapshot,
  );
  const [playback] = useState(() => new SharedPlayback(e, () => audio.stop()));
  const room = useSyncExternalStore(client.subscribe, () => client.snapshot);
  const sceneState = useSyncExternalStore(e.subscribe, () => e.snapshot);
  const vrState = useSyncExternalStore(vr.subscribe, () => vr.snapshot);
  const view = useRef<ViewState>({ yaw: 0, pitch: 0.32, zoom: false });
  const manual = useRef(true);
  const [selected, setSelected] = useState<FlightId | null>(null);
  const [resting, setResting] = useState(true);
  const [volume, setVolume] = useState(35);
  const [note, setNote] = useState("");
  const [page, setPage] = useState<SharedPage>("main");
  const [point, setPoint] = useState<"a" | "b">("a");
  const [, repaint] = useState(0);
  const recipe = room.state?.draft ?? DEFAULT_WORKSHOP;
  const compiled = useMemo(() => checkedWorkshop(recipe).route, [recipe]);
  const now = client.now();
  const next = room.state?.flights.find((f) => f.startsAt > now);
  const active = room.state?.flights.find(
    (f) => f.startsAt <= now && f.clearAt > now,
  );
  const visitor =
    room.role === "viewer" ||
    (room.role === "unknown" &&
      new URLSearchParams(location.search).get("visit") === "1");
  const exhibition = !!room.state?.exhibition;
  const repeating = !!room.state?.exhibition?.repeat;
  const enabled = client.ready && !!room.state && room.role === "editor";
  const status =
    room.status === "connected"
      ? `${room.peers}台で共有中`
      : room.status === "idle"
        ? "部屋を作って、招待しよう"
        : room.status === "connecting"
          ? "接続しています…"
          : "共有への接続が切れています";
  const facts = observeRoom(room.state, now, room.status === "connected");
  const towerText = describeRoom(facts);
  const canReadSituation =
    speechState.available &&
    room.status === "connected" &&
    !!facts.draft &&
    !resting &&
    volume > 0;
  const readSituation = () => {
    const fresh = observeRoom(
      client.snapshot.state,
      client.now(),
      client.snapshot.status === "connected",
    );
    if (!resting && volume > 0 && fresh.draft)
      speech.say(describeRoom(fresh).spoken, volume / 100);
  };
  const flightLabel = next
    ? `次の便まで ${Math.max(0, Math.ceil((next.startsAt - now) / 1000))}秒`
    : active
      ? towerText.title
      : visitor
        ? "運営が飛行を準備しています。"
        : "準備できたら、一緒に飛ばそう。";
  const update = (r: WorkshopRecipe) => {
    if (!enabled) return;
    try {
      checkedWorkshop(r);
      client.send({ type: "edit", recipe: r });
      setNote("");
    } catch (error) {
      setNote(
        error instanceof Error ? error.message : "設定を確認してください。",
      );
    }
  };
  const adjust = (kind: "altitude" | "speed", amount: number) => {
    const r = structuredClone(recipe);
    if (kind === "altitude")
      r.route.altitudeM = Math.max(
        140,
        Math.min(500, r.route.altitudeM + amount),
      );
    else
      r.flight.speedMps = Math.max(
        35,
        Math.min(75, r.flight.speedMps + amount),
      );
    update(r);
  };
  const movePoint = (axis: "x" | "z", amount: number) => {
    const r = structuredClone(recipe);
    r.route[point][axis] = Math.max(
      axis === "x" ? -3000 : -4200,
      Math.min(axis === "x" ? 3000 : 600, r.route[point][axis] + amount),
    );
    update(r);
  };
  const listen = async () => {
    try {
      await audio.enable();
      audio.setMuted(false);
      setResting(false);
      setNote("");
    } catch {
      setNote("音を開始できませんでした。もう一度、音を聴くを押してください。");
    }
  };
  const rest = () => {
    speech.stop();
    setResting(true);
    audio.stop();
  };
  const launch = () => {
    if (enabled && !next) {
      void listen();
      client.send({ type: "launch" });
    }
  };
  const clear = () => {
    setSelected(null);
    e.setMix("balanced");
  };
  const inspection = selected ? aircraftInfo(e, selected) : null;
  const look = () => {
    const id = selected ?? "ST-01";
    if (!aircraftInfo(e, id)?.visible) return;
    const p = e.pose(id).position,
      x = p.x - e.listener.x,
      y = p.y - e.listener.y,
      z = p.z - e.listener.z;
    view.current.yaw = Math.atan2(-x, -z);
    view.current.pitch = Math.atan2(y, Math.hypot(x, z));
  };
  vr.onLocalRest = rest;
  vr.onSelect = setSelected;
  vr.onClear = clear;
  vr.sharedPanel = sharedPanel({
    page,
    setPage,
    point,
    setPoint,
    room,
    recipe,
    vr,
    vrState,
    visitor,
    exhibition,
    repeating,
    next,
    active,
    enabled,
    resting,
    listen,
    rest,
    launch,
    clear,
    update,
    adjust,
    movePoint,
    volume,
    setVolume,
    audio,
    client,
    setNote,
    note,
    status,
    flightLabel,
    inspection,
    towerLines: towerText.lines,
    read: readSituation,
    stopSpeech: speech.stop,
    canRead: canReadSituation,
    speaking: speechState.speaking,
    speechMessage: speechState.message,
  });
  const tick = () => {
    const state = client.snapshot.state;
    if (!state) return;
    try {
      playback.tick(
        state,
        client.now(),
        resting || document.hidden || !vr.canAdvance,
      );
    } catch (error) {
      audio.stop();
      if (!note)
        setNote(
          error instanceof Error
            ? error.message
            : "飛行を同期できませんでした。",
        );
    }
  };
  useEffect(() => {
    speech.stop();
  }, [speech, facts.phase, facts.revision, vrState.status, volume]);
  useEffect(() => () => speech.dispose(), [speech]);
  useEffect(() => {
    audio.setVolume(volume / 100);
    audio.setMuted(resting);
  }, [audio, volume, resting]);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("room");
    const key = new URLSearchParams(location.hash.slice(1)).get("key");
    if (id && key) client.join(id, key);
    else if (id)
      setNote("招待URLには部屋の鍵も必要です。URL全体を開いてください。");
    const refresh = setInterval(() => repaint((n) => n + 1), 500);
    const hidden = () => {
      if (document.hidden) {
        speech.stop();
        setResting(true);
        audio.stop();
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearInterval(refresh);
      client.dispose();
      audio.dispose();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [client, audio, speech]);
  useEffect(() => {
    e.onArrival = (arrival, now) => {
      if (!resting && !document.hidden && vr.canAdvance)
        audio.play(
          arrival,
          now,
          e.recipe.lowFrequencyGain,
          e.designFor(arrival.flightId).engineCount,
        );
    };
    window.render_game_to_text = () =>
      JSON.stringify({
        ...e.getSnapshot(),
        coordinateSystem:
          "meters; +X east, +Y up, -Z north; ground observer origin",
        mode: "shared",
        room: {
          ...client.snapshot,
          state: client.snapshot.state
            ? { ...client.snapshot.state, recentOperations: undefined }
            : null,
          now: client.now(),
        },
        tower: {
          ...observeRoom(
            client.snapshot.state,
            client.now(),
            client.snapshot.status === "connected",
          ),
          speech: speech.snapshot,
          source: "rules",
        },
        playbackId: playback.flightId,
        resting,
        listener: e.listener,
        vr: vr.diagnostics,
        aircraft: e.pose(),
        inspection: selected ? aircraftInfo(e, selected) : null,
        audio: {
          state: audio.context?.state ?? "locked",
          played: audio.played,
          activeVoices: audio.activeVoices,
          listener: audio.listenerPose,
        },
      });
    // Shared time is server time. Local-only accelerated time would desynchronize peers.
    Reflect.deleteProperty(window, "advanceTime");
  }, [e, audio, vr, client, playback, resting, selected, speech]);
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(recipe, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "airplanevoice-flight.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <main className={`shared-app${visitor ? " visitor-app" : ""}`}>
      <header className="shared-header">
        <a href="./">音航跡 / AIRPLANEVOICE</a>
        <span>
          共有する空 <small>v0.9.1</small>
        </span>
      </header>
      <div className="shared-layout">
        <aside className="shared-controls" aria-label="共有する空の設定">
          <div className="shared-heading">
            <span className="eyebrow">
              {visitor ? "旅客機を見上げる" : "MAKE A SKY TOGETHER"}
            </span>
            <h1>
              {visitor ? "空を見上げて、" : "同じ空で、"}
              <br />
              {visitor ? "旅客機の声を聴く。" : "つくって飛ばそう。"}
            </h1>
            <p>
              {visitor
                ? "音のする方へ、ゆっくり顔を向けてみよう。"
                : "PCでも、Questでも。次の飛び方を一緒に。"}
            </p>
          </div>
          <p className="room-status" role="status">
            {status}
            {room.pending ? " · 反映待ち" : ""}
          </p>
          {(room.error || note) && (
            <p className="shared-error" role="alert">
              {room.error || note}
            </p>
          )}
          {!room.state ? (
            <>
              {!visitor && (
                <>
                  <button
                    className="primary"
                    disabled={room.status === "connecting"}
                    onClick={() => void client.create()}
                  >
                    共有する部屋をつくる
                  </button>
                  <p>部屋は1時間。招待した人は同じ設定を編集できます。</p>
                  <button
                    disabled={room.status === "connecting"}
                    onClick={() => void client.create(true)}
                  >
                    展示用の部屋をつくる（8時間）
                  </button>
                  <p>
                    運営が飛行を準備し、来場者は観覧用QRから入ります。同時に4台まで。
                  </p>
                </>
              )}
              {client.id && (
                <button onClick={client.reconnect}>招待した部屋へ再接続</button>
              )}
            </>
          ) : (
            <>
              {!visitor && (
                <div className="shared-flight">
                  <strong>{flightLabel}</strong>
                  <p>編集中の設定は、次に飛ばす便へ反映します。</p>
                  <button
                    id="shared-launch"
                    className="primary"
                    disabled={!enabled || !!next || repeating}
                    onClick={launch}
                  >
                    {active ? "次の便を予約" : "一緒に飛ばす"}
                  </button>
                  {next && !repeating && (
                    <button
                      disabled={!enabled}
                      onClick={() => client.send({ type: "cancel-next" })}
                    >
                      次の便を取り消す
                    </button>
                  )}
                  {exhibition && (
                    <>
                      <button
                        id="exhibition-repeat"
                        disabled={!enabled}
                        onClick={() =>
                          client.send({ type: "repeat", enabled: !repeating })
                        }
                      >
                        {repeating ? "繰り返しを止める" : "展示の飛行を始める"}
                      </button>
                      <p>
                        {repeating
                          ? "繰り返し飛行中。止めると現在の便まで飛びます。"
                          : "開始すると、誰も操作しなくても同じ設定で飛び続けます。"}
                      </p>
                    </>
                  )}
                </div>
              )}
              <div className="shared-actions">
                <button onClick={() => (resting ? void listen() : rest())}>
                  {resting
                    ? visitor
                      ? "この画面で体験する"
                      : "音を聴く"
                    : "自分の音を休む"}
                </button>
                <button
                  id="vr-enter"
                  className={visitor ? "primary" : undefined}
                  disabled={
                    vrState.status !== "ready" &&
                    vrState.status !== "presenting"
                  }
                  onClick={() => {
                    if (vr.active) void vr.exit();
                    else {
                      void vr.enter(true);
                      void listen();
                    }
                  }}
                >
                  {vr.active
                    ? "ブラウザに戻る"
                    : visitor
                      ? "Questで体験をはじめる"
                      : "VRで空に立つ"}
                </button>
              </div>
              {vrState.error && <p role="alert">{vrState.error}</p>}
              {vrState.error && vrState.arSupported && (
                <button
                  onClick={() => {
                    void vr.enter(false);
                    void listen();
                  }}
                >
                  ARを使わずVRで開く
                </button>
              )}
              <RoomTower
                facts={facts}
                speech={speechState}
                canRead={canReadSituation}
                onRead={readSituation}
                onStop={speech.stop}
                showDraft={!visitor}
                resting={resting}
              />
              <details className="room-guide">
                <summary>Questでの操作案内</summary>
                <p>
                  コントローラーで指して、人差し指のトリガーを押すと決定します。側面のグリップで操作盤を目の前に呼べます。
                </p>
                <p>
                  機体を指すと情報を表示。何もない場所を選ぶと解除します。音量や見え方は自分だけに反映します。
                </p>
                <p>
                  操作盤の「見え方・操作案内」から、対応端末では現実の景色に機体を重ねられます。まずは移動せず、周りに気を配って眺めてください。
                </p>
              </details>
              <label className="shared-volume">
                自分の音量 {volume}%
                <input
                  aria-label="自分の音量"
                  type="range"
                  min="0"
                  max="70"
                  step="5"
                  value={volume}
                  onChange={(ev) => setVolume(+ev.target.value)}
                />
              </label>
              <div className="shared-actions">
                <button onClick={() => setSelected("ST-01")}>機体情報</button>
                <button
                  onClick={look}
                  disabled={!aircraftInfo(e, "ST-01")?.visible}
                >
                  機体の方を向く
                </button>
              </div>
              {inspection && (
                <AircraftInfo
                  info={inspection}
                  ids={e.flightIds}
                  onSelect={setSelected}
                  onClose={clear}
                  onClear={clear}
                  onLook={look}
                />
              )}
              {!visitor && (
                <>
                  <fieldset disabled={!enabled} className="shared-editor">
                    <legend>次に飛ばす設定</legend>
                    <label>
                      機体
                      <select
                        aria-label="共有する機体"
                        value={AIRCRAFT_PATTERNS.findIndex(
                          (p) =>
                            p.aircraft.bodyLengthM ===
                            recipe.aircraft.bodyLengthM,
                        )}
                        onChange={(ev) =>
                          update({
                            ...recipe,
                            aircraft:
                              AIRCRAFT_PATTERNS[+ev.target.value].aircraft,
                          })
                        }
                      >
                        {AIRCRAFT_PATTERNS.map((p, i) => (
                          <option key={p.name} value={i}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      航路の出発点
                      <select
                        aria-label="共有する航路"
                        value=""
                        onChange={(ev) => {
                          const p = ROUTE_PATTERNS[+ev.target.value];
                          update({
                            ...recipe,
                            route: p.route,
                            flight: p.flight,
                          });
                        }}
                      >
                        <option value="" disabled>
                          パターンから変更
                        </option>
                        {ROUTE_PATTERNS.map((p, i) => (
                          <option key={p.name} value={i}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="shared-step">
                      <button
                        aria-label="共有高度を下げる"
                        onClick={() => adjust("altitude", -20)}
                      >
                        −
                      </button>
                      <span>
                        高度 <b>{recipe.route.altitudeM} m</b>
                      </span>
                      <button
                        aria-label="共有高度を上げる"
                        onClick={() => adjust("altitude", 20)}
                      >
                        ＋
                      </button>
                    </div>
                    <div className="shared-step">
                      <button
                        aria-label="共有速度を下げる"
                        onClick={() => adjust("speed", -5)}
                      >
                        −
                      </button>
                      <span>
                        速度 <b>{recipe.flight.speedMps} m/s</b>
                      </span>
                      <button
                        aria-label="共有速度を上げる"
                        onClick={() => adjust("speed", 5)}
                      >
                        ＋
                      </button>
                    </div>
                    <AnchorMap
                      generator={recipe.route}
                      route={compiled.samples.map((s) => s.position)}
                      onChange={(route) => update({ ...recipe, route })}
                    />
                  </fieldset>
                  <button onClick={download}>次の設定をJSONで保存</button>
                  <label className="shared-import">
                    保存した設定を読み込む
                    <input
                      type="file"
                      accept="application/json,.json"
                      disabled={!enabled}
                      onChange={async (ev) => {
                        const file = ev.target.files?.[0];
                        if (!file) return;
                        if (file.size > 12000) {
                          setNote("設定は12,000バイト以内にしてください。");
                          return;
                        }
                        try {
                          const r = checkedWorkshop(
                            JSON.parse(await file.text()),
                          );
                          update(r.recipe);
                        } catch {
                          setNote(
                            "この設定を読み込めませんでした。前の設定を保ちます。",
                          );
                        }
                        ev.target.value = "";
                      }}
                    />
                  </label>
                  <RoomInvite
                    key={client.id}
                    client={client}
                    exhibition={exhibition}
                    expiresAt={room.state.expiresAt}
                    onNote={setNote}
                  />
                </>
              )}
              {room.status !== "connected" && (
                <button onClick={client.reconnect}>再接続</button>
              )}
              {room.status === "failed" && (
                <p>
                  <a href="?shared=1">新しい部屋をつくる画面へ</a>
                </p>
              )}
              <p className="shared-footnote">
                同時飛行1機。自分の休憩や退出でも、みんなの空は動き続けます。
                {!visitor && (
                  <>
                    <br />
                    設定の版 {room.state.revision} / 往復通信 {room.rtt ?? "—"}{" "}
                    ms
                  </>
                )}
              </p>
            </>
          )}
        </aside>
        <section className="shared-view" aria-label="同じ旅客機を見上げる空">
          <Scene
            experience={e}
            audio={audio}
            vr={vr}
            soundOn={!resting}
            view={view}
            manual={manual}
            reduced={false}
            selectedId={selected}
            onSelect={setSelected}
            onClear={clear}
            onFrame={tick}
          />
          <div className="shared-caption">
            <span>
              {room.state ? flightLabel : "遠くから来る、一機を待つ。"}
            </span>
            <small>
              {sceneState.phase === "EDIT"
                ? "飛行前のプレビュー"
                : resting
                  ? "音を休んでいます。共有の飛行は続いています。"
                  : "ドラッグで見回す / 機体をクリックして選択"}
            </small>
          </div>
        </section>
      </div>
    </main>
  );
}
