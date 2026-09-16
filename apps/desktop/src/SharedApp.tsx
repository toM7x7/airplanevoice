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
import { VrRuntime, type SharedVrPanel } from "./vr";
import { Scene, type ViewState } from "./Scene";
import { AnchorMap } from "./Workshop";
import { AircraftInfo } from "./AircraftInfo";
import "./shared.css";

export function SharedApp() {
  const [e] = useState(() => new Experience());
  const [audio] = useState(() => new AircraftAudio());
  const [vr] = useState(() => new VrRuntime(e, audio));
  const [client] = useState(() => new RoomClient());
  const [playback] = useState(() => new SharedPlayback(e, () => audio.stop()));
  const room = useSyncExternalStore(client.subscribe, () => client.snapshot);
  const sceneState = useSyncExternalStore(e.subscribe, () => e.snapshot);
  const vrState = useSyncExternalStore(vr.subscribe, () => vr.snapshot);
  const view = useRef<ViewState>({ yaw: 0, pitch: 0.32, zoom: false });
  const manual = useRef(true);
  const [selected, setSelected] = useState<FlightId | null>(null);
  const [resting, setResting] = useState(true);
  const [volume, setVolume] = useState(35);
  const [qr, setQr] = useState("");
  const [note, setNote] = useState("");
  const [page, setPage] = useState<"main" | "edit" | "points" | "audio">(
    "main",
  );
  const [point, setPoint] = useState<"a" | "b">("a");
  const [, repaint] = useState(0);
  const recipe = room.state?.draft ?? DEFAULT_WORKSHOP;
  const compiled = useMemo(() => checkedWorkshop(recipe).route, [recipe]);
  const now = client.now();
  const next = room.state?.flights.find((f) => f.startsAt > now);
  const active = room.state?.flights.find(
    (f) => f.startsAt <= now && f.clearAt > now,
  );
  const enabled = client.ready && !!room.state;
  const status =
    room.status === "connected"
      ? `${room.peers}台で共有中`
      : room.status === "idle"
        ? "部屋を作って、招待しよう"
        : room.status === "connecting"
          ? "接続しています…"
          : "共有への接続が切れています";
  const flightLabel = next
    ? `次の便まで ${Math.max(0, Math.ceil((next.startsAt - now) / 1000))}秒`
    : active
      ? "同じ旅客機が飛行中。次の設定を作れます。"
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
  const buttons: SharedVrPanel["buttons"] = [];
  const add = (label: string, press: () => void, allowed = true) => {
    const n = buttons.length;
    buttons.push({
      label,
      press,
      enabled: allowed,
      x: 30 + (n % 2) * 497,
      y: 157 + Math.floor(n / 2) * 81,
      w: 467,
      h: 69,
    });
  };
  if (page === "main") {
    add(
      next ? "次の便を取り消す" : active ? "次の便を予約" : "一緒に飛ばす",
      () => (next ? client.send({ type: "cancel-next" }) : launch()),
      enabled,
    );
    add(resting ? "音を聴く" : "自分の音を休む", () =>
      resting ? void listen() : rest(),
    );
    add("機体・航路を変える", () => setPage("edit"), !!room.state);
    add("2地点を動かす", () => setPage("points"), !!room.state);
    add("音の設定", () => setPage("audio"));
    add("選択を外す", clear);
    add("再接続", client.reconnect, room.status !== "connected");
    add("VRを終了", () => void vr.exit());
  } else if (page === "edit") {
    add(
      `機体：${recipe.aircraft.engineCount}発 → 別の機体`,
      () => {
        const index = AIRCRAFT_PATTERNS.findIndex(
          (p) => p.aircraft.bodyLengthM === recipe.aircraft.bodyLengthM,
        );
        update({
          ...recipe,
          aircraft: AIRCRAFT_PATTERNS[(index + 1) % 3].aircraft,
        });
      },
      enabled,
    );
    add(
      "別の航路にする",
      () => {
        const index = ROUTE_PATTERNS.findIndex(
          (p) =>
            p.route.seed === recipe.route.seed &&
            p.route.altitudeM === recipe.route.altitudeM,
        );
        const pattern = ROUTE_PATTERNS[(index + 1) % 4];
        update({ ...recipe, route: pattern.route, flight: pattern.flight });
      },
      enabled,
    );
    add("高度 −20 m", () => adjust("altitude", -20), enabled);
    add("高度 ＋20 m", () => adjust("altitude", 20), enabled);
    add("速度 −5 m/s", () => adjust("speed", -5), enabled);
    add("速度 ＋5 m/s", () => adjust("speed", 5), enabled);
    add("空の操作へ", () => setPage("main"));
    add("2地点を動かす", () => setPage("points"));
  } else if (page === "points") {
    add(`A地点 ${point === "a" ? "選択中" : ""}`, () => setPoint("a"));
    add(`B地点 ${point === "b" ? "選択中" : ""}`, () => setPoint("b"));
    add("西へ 100 m", () => movePoint("x", -100), enabled);
    add("東へ 100 m", () => movePoint("x", 100), enabled);
    add("北へ 100 m", () => movePoint("z", -100), enabled);
    add("南へ 100 m", () => movePoint("z", 100), enabled);
    add("空の操作へ", () => setPage("main"));
    add("機体・航路へ", () => setPage("edit"));
  } else {
    add("音量 −5", () => setVolume((v) => Math.max(0, v - 5)));
    add("音量 ＋5", () => setVolume((v) => Math.min(70, v + 5)));
    add("本体スピーカー向け", () => {
      audio.setOutputProfile("speaker");
      setNote("本体スピーカー向け");
    });
    add("ヘッドホン向け", () => {
      audio.setOutputProfile("headphones");
      setNote("ヘッドホン向け");
    });
    add(resting ? "音を聴く" : "自分の音を休む", () =>
      resting ? void listen() : rest(),
    );
    add("空の操作へ", () => setPage("main"));
  }
  vr.sharedPanel = {
    title:
      page === "main"
        ? "AIRPLANEVOICE / 共有する空"
        : page === "edit"
          ? "次の機体・航路をつくる"
          : page === "points"
            ? "次の航路 / 2地点を動かす"
            : "自分の音の設定",
    status: room.error || note || `${status} / ${flightLabel}`,
    detail:
      inspection?.visible && page === "main"
        ? `${inspection.id} / ${Math.round(inspection.speedMps! * 3.6)} km/h / ${inspection.headingLabel} ${Math.round(inspection.headingDeg!)}°`
        : page === "points"
          ? `${point.toUpperCase()}：東西 ${recipe.route[point].x} m / 南北 ${recipe.route[point].z} m`
          : `${recipe.aircraft.engineCount}発 / 高度 ${recipe.route.altitudeM} m / 速度 ${recipe.flight.speedMps} m/s / 音量 ${volume}%`,
    buttons,
  };
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
  }, [client, audio]);
  useEffect(() => {
    if (!room.state || !client.id) return;
    let live = true;
    void import("qrcode")
      .then((QR) =>
        QR.toDataURL(client.invite, {
          width: 440,
          margin: 3,
          errorCorrectionLevel: "M",
        }),
      )
      .then((image) => {
        if (live) setQr(image);
      })
      .catch(() => {
        if (live) setNote("QRを生成できません。招待URLをコピーして渡せます。");
      });
    return () => {
      live = false;
    };
  }, [client, !!room.state]);
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
  }, [e, audio, vr, client, playback, resting, selected]);
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
    <main className="shared-app">
      <header className="shared-header">
        <a href="./">音航跡 / AIRPLANEVOICE</a>
        <span>
          共有する空 <small>v0.8.0</small>
        </span>
      </header>
      <div className="shared-layout">
        <aside className="shared-controls" aria-label="共有する空の設定">
          <div className="shared-heading">
            <span className="eyebrow">MAKE A SKY TOGETHER</span>
            <h1>
              同じ空で、
              <br />
              つくって飛ばそう。
            </h1>
            <p>PCでも、Questでも。次の飛び方を一緒に。</p>
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
              <button
                className="primary"
                disabled={room.status === "connecting"}
                onClick={() => void client.create()}
              >
                共有する部屋をつくる
              </button>
              <p>部屋は1時間。招待した人は同じ設定を編集できます。</p>
              {client.id && (
                <button onClick={client.reconnect}>招待した部屋へ再接続</button>
              )}
            </>
          ) : (
            <>
              <div className="shared-flight">
                <strong>{flightLabel}</strong>
                <p>編集中の設定は、次に飛ばす便へ反映します。</p>
                <button
                  id="shared-launch"
                  className="primary"
                  disabled={!enabled || !!next}
                  onClick={launch}
                >
                  {active ? "次の便を予約" : "一緒に飛ばす"}
                </button>
                {next && (
                  <button
                    disabled={!enabled}
                    onClick={() => client.send({ type: "cancel-next" })}
                  >
                    次の便を取り消す
                  </button>
                )}
              </div>
              <div className="shared-actions">
                <button onClick={() => (resting ? void listen() : rest())}>
                  {resting ? "音を聴く" : "自分の音を休む"}
                </button>
                <button
                  id="vr-enter"
                  disabled={
                    vrState.status !== "ready" &&
                    vrState.status !== "presenting"
                  }
                  onClick={() => {
                    if (vr.active) void vr.exit();
                    else {
                      void vr.enter();
                      void listen();
                    }
                  }}
                >
                  {vr.active ? "VRを終了" : "VRで空に立つ"}
                </button>
              </div>
              {vrState.error && <p role="alert">{vrState.error}</p>}
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
              <fieldset disabled={!enabled} className="shared-editor">
                <legend>次に飛ばす設定</legend>
                <label>
                  機体
                  <select
                    aria-label="共有する機体"
                    value={AIRCRAFT_PATTERNS.findIndex(
                      (p) =>
                        p.aircraft.bodyLengthM === recipe.aircraft.bodyLengthM,
                    )}
                    onChange={(ev) =>
                      update({
                        ...recipe,
                        aircraft: AIRCRAFT_PATTERNS[+ev.target.value].aircraft,
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
                      update({ ...recipe, route: p.route, flight: p.flight });
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
                      const r = checkedWorkshop(JSON.parse(await file.text()));
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
              <details className="room-invite">
                <summary>Quest・もう一台を招待</summary>
                {qr && <img src={qr} alt="共有する部屋の招待QR" />}
                <input
                  aria-label="部屋の招待URL"
                  readOnly
                  value={client.invite}
                />
                <button
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(client.invite)
                      .then(() => setNote("招待URLをコピーしました。"))
                      .catch(() =>
                        setNote("URL欄を選択してコピーしてください。"),
                      );
                  }}
                >
                  招待URLをコピー
                </button>
                <p>
                  同じURLで入り直せます。部屋の期限は{" "}
                  {new Date(room.state.expiresAt).toLocaleTimeString("ja-JP")}
                  。QRの読み取りには{" "}
                  <a href="https://xrqr.net/" target="_blank" rel="noreferrer">
                    XRQR
                  </a>{" "}
                  も使えます。
                </p>
              </details>
              {room.status !== "connected" && (
                <button onClick={client.reconnect}>再接続</button>
              )}
              {room.status === "failed" && (
                <p>
                  <a href="?shared=1">新しい部屋をつくる画面へ</a>
                </p>
              )}
              <p className="shared-footnote">
                初回試作：同時飛行1機。自分の休憩やVR退出でも相手の空は動き続けます。
                <br />
                設定の版 {room.state.revision} / 往復通信 {room.rtt ?? "—"} ms
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
