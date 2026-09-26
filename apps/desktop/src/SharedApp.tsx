import {
  editNameKeys,
  nameKeyboardPanel,
  type NameKeys,
} from "./ui/name-keyboard";
import { CreationShelf } from "./CreationShelf";
import { xrMenuPage } from "./ui/xr-menu-page";
import {
  TRACE_LABELS,
  type SoundTraceMode,
} from "../../../packages/core/src/sound-presence";
import { TrafficPanel } from "./TrafficPanel";
import { FlightRadar } from "./FlightRadar";
import { EnvironmentPanel } from "./EnvironmentPanel";
import {
  DEFAULT_ENVIRONMENT,
  changeEnvironment,
  type EnvironmentRecipe,
} from "../../../packages/core/src/environment";
import { CreationPanel } from "./CreationPanel";
import { xrWorkbench, type XrTab } from "./XrWorkbench";
import { CreationWorkspace, savedCreations } from "./creation-workspace";
import {
  Workbench,
  type DesktopPlace,
  type PreviewBackground,
  type EditorCategory,
} from "./Workbench";
import type { HangarEntry } from "../../../packages/core/src/hangar";
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
import { DEFAULT_VENUE, type VenueMap } from "../../../packages/core/src/venue";
import { VenuePanel } from "./VenuePanel";
import { RoomAlignmentStatus } from "./RoomAlignmentStatus";
import { tableFrameId } from "../../../packages/core/src/room-presence";
import { AiTrialPanel, type VoiceControls } from "./ai/AiTrialPanel";
import {
  AssistantGuide,
  skyContext,
  useSkyAssistant,
} from "./ai/sky-assistant";

export function SharedApp() {
  const [e] = useState(() => {
    const engine = new Experience();
    engine.setMix("balanced");
    return engine;
  });
  const [audio] = useState(() => new AircraftAudio());
  const [vr] = useState(() => new VrRuntime(e, audio));
  const [client] = useState(() => new RoomClient());
  const [workspace] = useState(() => new CreationWorkspace());
  const [desktopPlace, setDesktopPlace] = useState<DesktopPlace>("hangar");
  const [background, setBackground] = useState<PreviewBackground>("hangar");
  const [category, setCategory] = useState<EditorCategory>("shape");
  const [switchTarget, setSwitchTarget] = useState<{
    entry: HangarEntry | null;
  } | null>(null);
  const switchDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (switchTarget && !switchDialog.current?.open)
      switchDialog.current?.showModal();
  }, [switchTarget]);
  const creation = useSyncExternalStore(
    workspace.subscribe,
    () => workspace.snapshot,
  );
  const [nameKeys, setNameKeys] = useState<NameKeys | null>(null);
  const [modelTools, setModelTools] = useState(false);
  const [xrTab, setXrTab] = useState<XrTab>("shape");
  const [patternPage, setPatternPage] = useState(0);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [environmentDraft, setEnvironmentDraft] = useState<EnvironmentRecipe>({
    ...DEFAULT_ENVIRONMENT,
  });
  const [freeView, setFreeView] = useState(false);
  const [environmentSubmission, setEnvironmentSubmission] = useState<
    string | null
  >(null);
  const groundView = useRef({ x: 0, y: 1.7, z: 0 });
  useEffect(() => {
    if (!creation.open) {
      setNameKeys(null);
      setModelTools(false);
    }
  }, [creation.open]);
  const [saved, setSaved] = useState(savedCreations);
  const cloudBaselines = useRef(
    new Map(saved.map((entry) => [entry.id, entry])),
  );
  const savingCloud = useRef(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const cloudEntry =
    !new URLSearchParams(location.search).has("room") &&
    new URLSearchParams(location.search).get("private") !== "1";
  const [shelfOpen, setShelfOpen] = useState(false);
  const [shelfPage, setShelfPage] = useState(0);
  const [fleetPage, setFleetPage] = useState(0);
  const [creationMessage, setCreationMessage] = useState("");
  const [preparingFlight, setPreparingFlight] = useState<HangarEntry | null>(
    null,
  );
  const [submission, setSubmission] = useState<string | null>(null);
  const repeatNewRoom = useRef(false);
  const [voiceControls, setVoiceControls] = useState<VoiceControls | null>(
    null,
  );
  const [speech] = useState<SpeechOutput>(() => new RoomSpeech());
  const speechState = useSyncExternalStore(
    speech.subscribe,
    () => speech.snapshot,
  );
  const [playback] = useState(() => new SharedPlayback(e, () => audio.stop()));
  const room = useSyncExternalStore(client.subscribe, () => client.snapshot);
  useEffect(() => {
    if (!environmentSubmission) return;
    if (room.state?.recentOperations.includes(environmentSubmission)) {
      setNote("景色をみんなの空に反映しました。Questでも同じ景色になります。");
      setEnvironmentSubmission(null);
    } else if (!room.pending && room.error) {
      setNote(room.error);
      setEnvironmentSubmission(null);
    }
  }, [environmentSubmission, room.state, room.pending, room.error]);
  useEffect(() => {
    if (!environmentOpen)
      setEnvironmentDraft(
        structuredClone(room.state?.environment ?? DEFAULT_ENVIRONMENT),
      );
  }, [environmentOpen, room.state?.environment]);
  const sceneState = useSyncExternalStore(e.subscribe, () => e.snapshot);
  const vrState = useSyncExternalStore(vr.subscribe, () => vr.snapshot);
  useEffect(()=>{
    audio.setEnvironment(environmentOpen&&!vr.active?environmentDraft:room.state?.environment??DEFAULT_ENVIRONMENT,!(vr.active&&vrState.displayMode==="ar"));
  },[audio,environmentOpen,environmentDraft,room.state?.environment,vr,vrState.status,vrState.displayMode]);
  useEffect(() => {
    if (creation.open && vrState.status === "presenting") vr.recallCreation();
  }, [creation.open, creation.entry.id, vrState.status, vr]);
  const view = useRef<ViewState>({ yaw: 0, pitch: 0.32, zoom: false });
  const manual = useRef(true);
  const [selected, setSelected] = useState<FlightId | null>(null);
  useEffect(() => {
    if (!selected) e.setMix("balanced");
    else if (e.mixMode !== "balanced") e.setMix(e.mixMode, selected);
  }, [selected, e]);
  useEffect(() => {
    audio.setMix(e.mixGains);
  }, [audio, e, sceneState]);
  useEffect(() => {
    if (vr.active && view.current.free) {
      e.setListener(groundView.current);
      view.current.free = false;
      setFreeView(false);
    }
  }, [vrState.status, e, vr]);
  useEffect(() => {
    if (desktopPlace !== "observe") setEnvironmentOpen(false);
  }, [desktopPlace]);
  const [radarOpen, setRadarOpen] = useState(true);
  const instructionResult = useRef("");
  const selectedIdentity = useRef<{ id: FlightId; start: number } | null>(null);
  const selectedStart = e.flights.find((f) => f.id === selected)?.startAtMs;
  useEffect(() => {
    if (!selected) {
      selectedIdentity.current = null;
      return;
    }
    const old = selectedIdentity.current;
    if (
      selectedStart === undefined ||
      (old?.id === selected && old.start !== selectedStart)
    ) {
      setSelected(null);
      selectedIdentity.current = null;
    } else selectedIdentity.current = { id: selected, start: selectedStart };
  }, [selected, selectedStart]);
  const [resting, setResting] = useState(true);
  const restingNow = useRef(resting);
  restingNow.current = resting;
  // Sound silenced by taking the headset off or switching users returns when the view does.
  const resumeSound = useRef(false);
  const [volume, setVolume] = useState(35);
  const [note, setNote] = useState("");
  const [page, setPage] = useState<SharedPage>("main");
  const [point, setPoint] = useState<"a" | "b">("a");
  const [, repaint] = useState(0);
  const recipe = room.state?.draft ?? DEFAULT_WORKSHOP;
  const venue = room.state?.venue ?? DEFAULT_VENUE;
  const compiled = useMemo(() => checkedWorkshop(recipe).route, [recipe]);
  const now = client.now();
  const radarSource = () => ({
    experience: e,
    names: playback.names,
    selected,
    state: client.snapshot.state,
    now: client.now(),
    select: setSelected,
  });
  vr.radarSource = radarSource;
  const openRadar = () => {
    if (vr.active) {
      if (!vr.diagnostics.radar?.visible) vr.toggleRadar();
    } else setRadarOpen(true);
  };
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
  const canCreateFlight =
    ((!client.id && !cloudEntry) ||
      (client.ready &&
        !!room.state &&
        room.role !== "unknown" &&
        room.state.flights.filter((f) => f.startsAt > now).length < 64)) &&
    !submission &&
    !preparingFlight &&
    !cloudBusy;
  const canShareCreation =
    client.ready && !!room.state && room.role !== "unknown";
  const library = [
    ...new Map(
      [
        ...saved
          .filter(
            (entry) =>
              !room.state?.hangar?.some((shared) => shared.id === entry.id),
          )
          .map((entry) => ({ entry, place: "この端末のみ" })),
        ...(room.state?.hangar ?? []).map((entry) => ({
          entry,
          place: room.state?.persistent ? "クラウド" : "この部屋",
        })),
      ].map((item) => [
        JSON.stringify([item.entry.name, item.entry.recipe]),
        item,
      ]),
    ).values(),
  ];
  const cloudSaved = !!room.state?.hangar?.some(
    (entry) => JSON.stringify(entry) === JSON.stringify(creation.entry),
  );
  const localOnly = saved.filter(
    (entry) =>
      !room.state?.hangar?.some(
        (shared) =>
          shared.id === entry.id ||
          (shared.name === entry.name &&
            JSON.stringify(shared.recipe) === JSON.stringify(entry.recipe)),
      ),
  );
  const saveCloudEntry = async (entry: HangarEntry) => {
    if (savingCloud.current)
      throw new Error("保存中です。少しお待ちください。");
    savingCloud.current = true;
    setCloudBusy(true);
    try {
      const current = client.snapshot.state?.hangar?.find(
        (item) => item.id === entry.id,
      );
      if (JSON.stringify(current) !== JSON.stringify(entry))
        await client.saveHangar(
          entry,
          current ? (cloudBaselines.current.get(entry.id) ?? null) : null,
        );
      else if (!client.ready)
        throw new Error(
          "再接続してから保存してください。下書きは残っています。",
        );
      cloudBaselines.current.set(entry.id, structuredClone(entry));
      workspace.acknowledgeCloudSave(entry);
    } finally {
      savingCloud.current = false;
      setCloudBusy(false);
    }
  };
  const uploadLocal = async () => {
    let count = 0;
    try {
      for (const entry of localOnly) {
        await saveCloudEntry(structuredClone(entry));
        count++;
      }
      setCreationMessage(
        `${count}機をクラウド格納庫に保存しました。Questでも呼び出せます。`,
      );
    } catch (error) {
      setCreationMessage(
        `${count}機まで保存しました。${error instanceof Error ? error.message : "接続を確認してください。"}`,
      );
    }
  };
  const flightHelp = preparingFlight
    ? "空を準備しています…そのままお待ちください。"
    : submission
      ? "飛行の受付を確認しています…"
      : next && !next.automatic
        ? `次の便まであと${Math.max(1, Math.ceil((next.startsAt - now) / 1000))}秒。あなたの機体も続けて予約できます。`
        : !client.id
          ? "「飛ばす」で空を準備して出発します。部屋の事前作成は不要です。"
          : room.pending
            ? "部屋への変更を反映しています…"
            : room.status !== "connected"
              ? room.error ||
                (room.status === "connecting"
                  ? "部屋に接続しています…"
                  : "部屋との接続が切れています。「接続を確認」から戻れます。")
              : "この機体を空へ送ります。VRでもARでも飛ばせます。";
  useEffect(() => {
    if (!preparingFlight) return;
    if (client.ready && room.state && room.role !== "unknown") {
      const id = client.send({ type: "create-flight", entry: preparingFlight });
      setPreparingFlight(null);
      if (id) setSubmission(id);
      else
        setCreationMessage("受付できませんでした。もう一度飛ばしてください。");
    } else if (room.error) {
      setPreparingFlight(null);
      setCreationMessage(room.error);
    }
  }, [preparingFlight, room.state, room.status, room.role, room.error, client]);
  useEffect(() => {
    const sync = () => setSaved(savedCreations());
    window.addEventListener("airplanevoice-hangar-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("airplanevoice-hangar-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  useEffect(() => {
    if (!submission) return;
    if (room.state?.recentOperations.includes(submission)) {
      const flight = room.state.flights.find((f) => f.id === submission);
      audio.feedback(flight ? "accepted" : "saved");
      setCreationMessage(
        flight
          ? `「${flight.names?.[0] ?? "あなたの機体"}」を受け付けました。順番に飛びます。`
          : "部屋の格納庫に登録しました。Questから呼び出せます。",
      );
      setSubmission(null);
      if (flight) {
        workspace.run("close");
        setDesktopPlace("observe");
        if (flight.departure && !vr.active) {
          view.current.yaw = 0.2;
          view.current.pitch = 0.06;
          view.current.zoom = false;
        }
        setPage("main");
        vr.hidePanel();
        if (
          repeatNewRoom.current &&
          room.role === "editor" &&
          room.state.exhibition
        ) {
          repeatNewRoom.current = false;
          client.send({ type: "repeat", enabled: true });
        }
      }
    } else if (!room.pending && room.error) {
      audio.feedback("error");
      setCreationMessage(room.error);
      setSubmission(null);
    }
  }, [submission, room.state, room.pending, room.error, vr, workspace]);
  const runCreation = async (value: string): Promise<boolean> => {
    try {
      if (
        (value === "save" || value === "share") &&
        (cloudEntry || client.cloud)
      ) {
        setCreationMessage("クラウドへの保存を確認しています…");
        await saveCloudEntry(structuredClone(workspace.snapshot.entry));
        audio.feedback("saved");
        setCreationMessage(
          "クラウド格納庫に保存しました。PC・Questで呼び出せます。",
        );
        return true;
      }
      if (value === "new-room-fly" && (cloudEntry || client.cloud)) {
        client.reconnect();
        setCreationMessage(
          "同じ展示空間へ再接続します。接続後に飛ばしてください。",
        );
        return true;
      }
      if (value === "environment") {
        if (!vr.canShowAR) return false;
        vr.toggleEnvironment();
        return true;
      }
      if (value === "keyboard") {
        setNameKeys({ text: workspace.snapshot.entry.name, mode: "かな" });
        return true;
      }
      if (value === "observe-ar") {
        if (!vr.canShowAR) return false;
        if (vr.snapshot.displayMode !== "ar") vr.toggleEnvironment();
        workspace.run("close");
        return true;
      }
      if (value === "model") {
        setModelTools(true);
        return true;
      }
      if (
        !cloudEntry &&
        (value === "new-room-fly" || (value === "fly" && !client.id)) &&
        !preparingFlight
      ) {
        repeatNewRoom.current = true;
        setPreparingFlight(structuredClone(workspace.snapshot.entry));
        setCreationMessage("");
        void listen();
        await client.create(true);
        return true;
      }
      if (value === "fly" || value === "share") {
        if (value === "fly" ? !canCreateFlight : !canShareCreation) {
          setCreationMessage(flightHelp);
          return false;
        }
        const submittedEntry = structuredClone(workspace.snapshot.entry);
        if (client.cloud) await saveCloudEntry(submittedEntry);
        const id = client.send({
          type: value === "fly" ? "create-flight" : "create-entry",
          entry: submittedEntry,
        });
        if (!id) return false;
        setSubmission(id);
        setCreationMessage("部屋への反映を確認しています…");
        if (value === "fly") void listen();
      } else if (value === "listen" || value === "compare") {
        await audio.preview(
          workspace.snapshot.entry.recipe.aircraft.engineCount,
          workspace.snapshot.entry.recipe.aircraft.sound,
          value === "compare",
        );
        setCreationMessage(
          value === "compare"
            ? "基準の音を2秒 → 短い無音 → 今の音を2秒。同じ音量・位置で比較します。"
            : "手元で2秒間試聴します。飛行時は距離と向きで聞こえ方が変わります。",
        );
      } else
        setCreationMessage(
          value === "save" ? "このブラウザの格納庫に保存しました。" : "",
        );
      workspace.run(value);
      if (value === "save") audio.feedback("saved");
      return true;
    } catch (error) {
      audio.feedback("error");
      setCreationMessage(
        error instanceof Error ? error.message : "制作内容を確認してください。",
      );
      return false;
    }
  };
  const openCreation = () => {
    setShelfOpen(false);
    setDesktopPlace("edit");
    setPage("main");
    void runCreation("open");
  };
  const openShelf = () => {
    workspace.run("close");
    setDesktopPlace("hangar");
    setShelfPage(0);
    setShelfOpen(true);
  };
  const loadCreation = (entry: HangarEntry) => {
    setSwitchTarget({ entry });
    setCreationMessage("");
  };
  const acceptSwitch = async (save: boolean) => {
    if (!switchTarget) return;
    if (save && !(await runCreation("save"))) return;
    if (switchTarget.entry) {
      workspace.load(
        save && switchTarget.entry.id === workspace.snapshot.entry.id
          ? workspace.snapshot.entry
          : switchTarget.entry,
      );
      cloudBaselines.current.set(
        workspace.snapshot.entry.id,
        structuredClone(workspace.snapshot.entry),
      );
    } else workspace.fresh();
    setSwitchTarget(null);
    setShelfOpen(false);
    setDesktopPlace("edit");
    setCategory("shape");
    setCreationMessage("呼び出しました。変更は自分の下書きにだけ反映します。");
  };
  const navigate = (place: DesktopPlace) => {
    setDesktopPlace(place);
    setSwitchTarget(null);
    setCreationMessage("");
    setShelfOpen(false);
    if (place === "edit") workspace.run("open");
    else workspace.run("close");
  };
  const cancelSwitch = () => {
    setSwitchTarget(null);
    if (creation.dirty) {
      setShelfOpen(false);
      setDesktopPlace("edit");
      workspace.run("open");
    }
  };
  const status =
    room.status === "connected"
      ? `${client.cloud ? "展示空間 · " : ""}${room.peers}台で共有中`
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
        ? "一機をつくって、空へ送り出そう。"
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
  const saveVenue = (venue: VenueMap) => {
    if (enabled) client.send({ type: "venue", venue });
  };
  useEffect(() => {
    vr.setTableFrame(client.id, venue);
  }, [
    vr,
    client,
    client.id,
    venue.baselineM,
    venue.tableHeightM,
    venue.tableDepthM,
  ]);
  useEffect(() => {
    if (vrState.calibration === "lost") setPage("spatial");
  }, [vrState.calibration]);
  useEffect(() => {
    // setTableFrame may just have invalidated the runtime before React re-renders.
    const current = vr.snapshot;
    client.setPresence({
      mode: current.status === "presenting" ? current.displayMode : "browser",
      calibration: current.calibration,
      frame: tableFrameId(venue),
      checkErrorM: current.alignmentCheck?.distanceM ?? null,
    });
  }, [
    client,
    vr,
    vrState.status,
    vrState.displayMode,
    vrState.calibration,
    vrState.alignmentCheck,
    venue.baselineM,
    venue.tableHeightM,
    venue.tableDepthM,
  ]);
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
    resumeSound.current = false;
    speech.stop();
    setResting(true);
    audio.stop();
  };
  const launch = () => {
    if (!client.id) {
      void runCreation("fly");
      return;
    }
    if (enabled && !next) {
      void listen();
      client.send({ type: "launch" });
    }
  };
  const clear = () => {
    setSelected(null);
    e.setMix("balanced");
  };
  const chooseMix = (mode: "balanced" | "focus" | "solo") => {
    if (mode !== "balanced" && !selected) return false;
    e.setMix(mode, selected ?? e.focusId);
    audio.setMix(e.mixGains);
    return true;
  };
  const instructFlight = async (
    instruction: "overhead" | "wide" | "higher",
  ) => {
    instructionResult.current = "";
    const plan = e.flights.find((f) => f.id === selected);
    const flight = client.snapshot.state?.flights.find(
      (f) => f.startsAt === plan?.startAtMs && f.slotIds?.includes(selected!),
    );
    if (!flight) {
      setNote("飛行中の機体を選んでください。");
      return false;
    }
    const id = client.send({
      type: "flight-instruction",
      flightId: flight.id,
      instruction,
      observer: { x: e.listener.x, z: e.listener.z },
    });
    if (!id) {
      setNote("共有に接続してから操作してください。");
      return false;
    }
    return new Promise<boolean>((resolve) => {
      const stop = client.subscribe(() => {
        const ok = client.snapshot.state?.recentOperations.includes(id);
        if (ok || !client.snapshot.pending) {
          clearTimeout(timer);
          stop();
          if (ok) {
            instructionResult.current = instruction;
            setNote(
              "指示を受け付けました。5秒後から航路を変え、約2分で元の航路に戻ります。",
            );
          } else setNote(client.snapshot.error || "航路は変更していません。");
          resolve(!!ok);
        }
      });
      const timer = setTimeout(() => {
        stop();
        setNote("指示の結果を確認できませんでした。接続を確認してください。");
        resolve(false);
      }, 8500);
    });
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
  const suspendSound = () => {
    const was = !restingNow.current || resumeSound.current;
    rest();
    resumeSound.current = was;
  };
  const resumeIfSuspended = () => {
    if (!resumeSound.current || document.hidden) return;
    resumeSound.current = false;
    void listen();
  };
  vr.onLocalSuspend = suspendSound;
  vr.onLocalResume = resumeIfSuspended;
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
    venue,
    saveVenue,
    openCreation,
    openShelf,
    voiceControls,
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
    else if (new URLSearchParams(location.search).get("private") !== "1")
      void client.openExhibition();
    const refresh = setInterval(() => repaint((n) => n + 1), 500);
    const hidden = () => {
      if (document.hidden) suspendSound();
      else resumeIfSuspended();
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
      audio.setMix(e.mixGains);
      if (!resting && !document.hidden && vr.canAdvance)
        audio.play(
          arrival,
          now,
          e.recipe.lowFrequencyGain,
          e.designFor(arrival.flightId).engineCount,
          e.designFor(arrival.flightId).sound,
        );
    };
    window.render_game_to_text = () =>
      JSON.stringify({
        ...e.getSnapshot(),
        coordinateSystem:
          "meters; +X east, +Y up, -Z north; ground observer origin",
        mode: "shared",
        presentation: {
          place: desktopPlace,
          background,
          category,
          switchPending: !!switchTarget,
        },
        creation: {
          aircraft: creation.entry.recipe.aircraft,
          ...workspace.snapshot,
          message: creationMessage,
          pending: !!submission,
        },
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
        fleet: e.flightIds.map((id) => ({
          id,
          name: playback.names.find((f) => f.id === id)?.name,
          started: e.flights.find((f) => f.id === id)?.started ?? false,
          ended: e.flights.find((f) => f.id === id)?.ended ?? false,
          pose: e.pose(id),
          design: e.designFor(id),
        })),
        hangar:
          client.snapshot.state?.hangar?.map(({ id, name }) => ({
            id,
            name,
          })) ?? [],
        resting,
        listener: e.listener,
        vr: vr.diagnostics,
        aircraft: e.pose(),
        inspection: selected ? aircraftInfo(e, selected) : null,
        audio: {
          space: audio.spaceSoundState,
          trace: e.soundTraceMode,
          levels: audio.levels,
          mixGains: audio.mixGains,
          buildingSound: audio.buildingSoundState,
          buses: audio.busLevels,
          volume: audio.volumeLevel,
          state: audio.context?.state ?? "locked",
          played: audio.played,
          activeVoices: audio.activeVoices,
          listener: audio.listenerPose,
        },
      });
    // Shared time is server time. Local-only accelerated time would desynchronize peers.
    Reflect.deleteProperty(window, "advanceTime");
  }, [
    e,
    audio,
    vr,
    client,
    playback,
    resting,
    selected,
    speech,
    workspace,
    creationMessage,
    submission,
    desktopPlace,
    background,
    category,
    switchTarget,
  ]);
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
  const assistant = useSkyAssistant(
    () =>
      skyContext(
        e,
        audio,
        {
          surface: "shared",
          controls: room.state
            ? [
                "volume",
                "sound",
                "aircraft",
                "mix",
                "environment",
                ...(room.role === "editor" ? ["route" as const] : []),
                "settings",
                "creation",
                "hangar",
                "menu",
              ]
            : ["creation", "hangar", "menu"],
          hangar: library.map(({ entry, place }) => ({
            id: entry.id,
            name: entry.name,
            place,
          })),
          ui: {
            mode: vr.active ? vr.snapshot.displayMode : "pc",
            place: shelfOpen
              ? "hangar"
              : creation.open
                ? "edit"
                : vr.active
                  ? "observe"
                  : desktopPlace,
            tab: vr.active ? xrTab : category,
            pendingAircraftId: switchTarget
              ? (switchTarget.entry?.id ?? "new-aircraft")
              : undefined,
            panelTitle: vr.active ? vr.sharedPanel?.title : undefined,
            buttons: vr.active
              ? vr.sharedPanel?.buttons
                  .filter((b) => b.enabled !== false)
                  .map((b) => b.label)
                  .slice(0, 20)
              : undefined,
            canFly: canCreateFlight,
            flightHelp,
          },
          creation: {
            id: creation.entry.id,
            open: creation.open,
            aircraft: creation.entry.recipe.aircraft,
            step: creation.step,
            name: creation.entry.name,
            dirty: creation.dirty,
            lastAction: creation.lastAction,
          },
          volume,
          soundOn: !resting && audio.context?.state === "running",
          selected: selected !== null,
          selectedId: selected,
          menuOpen: true,
          menuPage: creation.open
            ? (vr.active ? xrTab : category) === "sound"
              ? "sound"
              : "home"
            : page === "voice"
              ? "help"
              : "view",
          canEdit: false,
          settingsOpen: !!room.state,
          mixMode: e.mixMode,
          flightInstruction: instructionResult.current || undefined,
          environment: environmentDraft,
        },
        playback.names,
      ),
    async (a) => {
      if (a.control === "environment") {
        setEnvironmentDraft(changeEnvironment(environmentDraft, a.value));
        return true;
      }
      if (a.control === "mix")
        return chooseMix(a.value as "balanced" | "focus" | "solo");
      if (a.control === "route")
        return instructFlight(a.value as "overhead" | "wide" | "higher");
      if (a.control === "creation") return runCreation(a.value);
      if (a.control === "menu") return true; // reveal opens the app-owned destination.
      if (a.control === "hangar") {
        if (a.value === "open") return true;
        const entry = library.find(
          ({ entry }) => entry.id === a.value.slice(5),
        )?.entry;
        if (!entry) return false;
        if (creation.dirty) loadCreation(entry);
        else {
          workspace.load(entry);
          cloudBaselines.current.set(entry.id, structuredClone(entry));
          setSwitchTarget(null);
          setShelfOpen(false);
          setDesktopPlace("edit");
          setCategory("shape");
          setXrTab("shape");
          setCreationMessage(
            `「${entry.name}」を呼び出しました。変更は下書きに反映されます。`,
          );
        }
        return true;
      }
      if (a.control === "volume") {
        setVolume(Number(a.value));
        audio.setVolume(Number(a.value) / 100);
      } else if (a.control === "sound") {
        if (a.value === "off") rest();
        else if (audio.context?.state === "running") await listen();
        else return false;
      } else if (a.control === "aircraft") {
        if (a.value === "none") clear();
        else setSelected(a.value as FlightId);
      } else if (a.control !== "settings") return false;
      return true;
    },
    (control, value) => {
      vr.showPanel();
      setNameKeys(null);
      setModelTools(false);
      if (control === "hangar" || (control === "menu" && value === "hangar")) {
        openShelf();
        if (value?.startsWith("load:")) {
          const index = library.findIndex(
            ({ entry }) => entry.id === value.slice(5),
          );
          if (index >= 0) setShelfPage(Math.floor(index / 4));
        }
      } else if (control === "menu") {
        if (value === "new") {
          setSwitchTarget({ entry: null });
        } else if (value === "observe") {
          navigate("observe");
          setPage("main");
        } else {
          openCreation();
          const tab = value === "edit" ? "shape" : value;
          if (
            tab &&
            ["shape", "dimensions", "color", "sound", "name", "route"].includes(
              tab,
            )
          ) {
            setCategory(
              tab === "dimensions" ? "shape" : (tab as typeof category),
            );
            if (tab !== "route") setXrTab(tab as XrTab);
          }
        }
      } else if (control === "creation") {
        if (value?.startsWith("shape:") || value?.startsWith("color:"))
          setPatternPage(Math.floor(Number(value.split(":")[1]) / 3));
        setShelfOpen(false);
        setDesktopPlace("edit");
        setXrTab(
          /^(body|wings|width|sweep|engineSize|winglet|engines):/.test(
            value ?? "",
          )
            ? "dimensions"
            : /^(color|accent|paint):/.test(value ?? "")
              ? "color"
              : value?.startsWith("name:")
                ? "name"
                : value?.startsWith("tone:") ||
                    value === "listen" ||
                    value === "compare"
                  ? "sound"
                  : "shape",
        );
        if (/^(color|accent|paint):/.test(value ?? "")) setCategory("color");
        else if (
          value?.startsWith("tone:") ||
          value === "listen" ||
          value === "compare"
        )
          setCategory("sound");
        else if (value?.startsWith("name:")) setCategory("name");
        else if (
          /^(shape|design|body|wings|width|sweep|engineSize|winglet|engines):/.test(
            value ?? "",
          )
        )
          setCategory("shape");
        workspace.reveal(value ?? "open");
      } else if (control === "environment") {
        navigate("observe");
        setEnvironmentOpen(true);
      } else if (control === "route") {
        navigate("observe");
        setPage("flight-control");
      } else if (
        control === "volume" ||
        control === "sound" ||
        control === "mix"
      ) {
        navigate("observe");
        setPage(control === "mix" ? "listening" : "audio");
      } else if (control === "settings" || control === "aircraft") {
        navigate(vr.active ? "observe" : "operator");
        setPage(control === "aircraft" ? "fleet" : "audio");
      }
    },
    (a) => {
      if (!vr.active) return undefined;
      if (!vr.diagnostics.panel?.visible || switchTarget) return false;
      if (a.control === "creation")
        return !!vr.sharedPanel?.buttons.some(
          (b) => b.highlight && b.role !== "navigation",
        );
      return (
        !!vr.sharedPanel?.guided ||
        !!vr.sharedPanel?.buttons.some((b) => b.highlight)
      );
    },
  );
  const creationGuide =
    assistant.guide?.action.control === "creation" &&
    assistant.guide.action.mode === "guide"
      ? assistant.guide.action.value
      : undefined;
  const disconnectedRoom = !!client.id && room.status !== "connected";
  if (page === "main" && !creation.open && !shelfOpen) {
    const homeButtons = [
      {
        label: disconnectedRoom ? "接続を確認" : "この機体を飛ばす",
        press: () =>
          disconnectedRoom ? setPage("connection") : void runCreation("fly"),
        enabled: disconnectedRoom || canCreateFlight,
        role: "primary",
        x: 28,
        y: 145,
        w: 968,
        h: 66,
      },
      {
        label: "機体を編集",
        press: openCreation,
        x: 28,
        y: 223,
        w: 312,
        h: 50,
      },
      {
        label: "新しい機体をつくる",
        press: () => setSwitchTarget({ entry: null }),
        x: 356,
        y: 223,
        w: 312,
        h: 50,
      },
      {
        label: "保存した機体",
        press: openShelf,
        x: 684,
        y: 223,
        w: 312,
        h: 50,
      },
      {
        label: "AIと相談",
        press: () => setPage("voice"),
        x: 28,
        y: 285,
        w: 312,
        h: 50,
      },
      {
        label: "飛行中の機体",
        press: () => setPage("fleet"),
        x: 356,
        y: 285,
        w: 312,
        h: 50,
      },
      {
        label: "音・見え方の設定",
        press: () => setPage("view"),
        x: 684,
        y: 285,
        w: 312,
        h: 50,
      },
      {
        label: "フライトレーダー",
        press: openRadar,
        x: 28,
        y: 351,
        w: 968,
        h: 56,
        role: "utility",
      },
      {
        label: vrState.displayMode === "ar" ? "VRに戻る" : "ARで見る",
        press: () => vr.toggleEnvironment(),
        enabled: vr.canShowAR,
        x: 28,
        y: 351,
        w: 476,
        h: 56,
        role: "utility",
      },
      {
        label: "ブラウザに戻る",
        press: () => void vr.exit(),
        x: 520,
        y: 351,
        w: 476,
        h: 56,
        role: "navigation",
      },
    ];
    vr.sharedPanel = {
      layout: "authored",
      title: "あなたの一機を、空へ",
      status: `${creation.entry.name} / ${flightLabel}`,
      detail: creationMessage || flightHelp,
      buttons: homeButtons.filter(
        (b) => !["ARで見る", "VRに戻る", "ブラウザに戻る"].includes(b.label),
      ),
    };
  }
  if (page === "fleet" && !creation.open && !shelfOpen) {
    vr.sharedPanel = {
      title: "飛行中・出発待ちの機体",
      status: flightLabel,
      detail: inspection?.visible
        ? `${playback.names.find((f) => f.id === selected)?.name ?? selected}：距離 ${Math.round(inspection.distanceM ?? 0)}m / 高さ ${Math.round(inspection.altitudeM ?? 0)}m / ${inspection.headingLabel}へ`
        : "名前を選んで距離・高さ・向きを確認。保存だけでは出発しません。",
      layout: "authored",
      buttons: [
        ...playback.names.map((f) => ({
          label: `${f.name} · ${now < f.startsAt ? `あと${Math.ceil((f.startsAt - now) / 1000)}秒` : now < f.endsAt ? "飛行中" : "音の余韻"}`,
          press: () => {
            setSelected(f.id as typeof e.focusId);
          },
        })),
        { label: "GPTライブ・Jev", press: () => setPage("voice") },
        { label: "保存した機体を呼び出す", press: openShelf },
        { label: "空のメニューに戻る", press: () => setPage("main") },
      ].map((b, i) => ({
        ...b,
        x: 28 + (i % 2) * 494,
        y: 145 + Math.floor(i / 2) * 82,
        w: 476,
        h: 66,
      })),
    };
  }
  if (page === "connection" && !creation.open) {
    vr.sharedPanel = {
      title: "部屋との接続",
      status:
        room.status === "connected"
          ? "接続できました。飛ばせます。"
          : flightHelp,
      detail: client.cloud
        ? "PCもQuestも、この展示空間とクラウド格納庫につながります。"
        : "再接続は同じ部屋へ。新しい空は別の部屋で飛ばします。",
      buttons: [
        {
          label: "同じ部屋に再接続",
          press: () => client.reconnect(),
          enabled: room.status !== "connecting",
        },
        {
          label: client.cloud ? "展示空間に接続し直す" : "新しい空で飛ばす",
          press: () => void runCreation("new-room-fly"),
          enabled: !preparingFlight && room.status !== "connecting",
        },
        { label: "空のメニュー", press: () => setPage("main") },
        { label: "ブラウザに戻る", press: () => void vr.exit() },
      ].map((b, i) => ({
        ...b,
        x: 28 + (i % 2) * 492,
        y: 151 + Math.floor(i / 2) * 65,
        w: 476,
        h: 55,
      })),
    };
  }
  if (creation.open && nameKeys) {
    vr.sharedPanel = nameKeyboardPanel(nameKeys, (key) => {
      if (key === "取消") setNameKeys(null);
      else if (key === "確定") {
        if (nameKeys.text.trim()) {
          void runCreation(`name:${nameKeys.text}`);
          setNameKeys(null);
        }
      } else setNameKeys(editNameKeys(nameKeys, key));
    });
  } else if (creation.open && modelTools) {
    vr.sharedPanel = {
      layout: "authored",
      title: "手元の模型",
      status: "つまんで移動・回転／ボタンでも調整できます",
      detail: "模型だけの調整です。飛行する機体の実寸は変わりません。",
      buttons: [
        "左へ回す",
        "右へ回す",
        "大きく",
        "小さく",
        "手元へ戻す",
        "向きを戻す",
      ]
        .map((label, i) => ({
          label,
          x: 30 + (i % 2) * 494,
          y: 145 + Math.floor(i / 2) * 66,
          w: 476,
          h: 56,
          press: () => vr.creationModel?.command(i),
        }))
        .concat([
          {
            label: "制作に戻る",
            x: 524,
            y: 365,
            w: 476,
            h: 42,
            press: () => setModelTools(false),
          },
        ]),
    };
  } else if (creation.open)
    vr.sharedPanel = xrWorkbench({
      patternPage,
      nextPatterns: () => setPatternPage((v) => (v + 1) % 2),
      saveStatus:
        cloudEntry || client.cloud
          ? cloudBusy
            ? "クラウドへ保存中"
            : cloudSaved
              ? "クラウド保存済み"
              : "クラウド未保存"
          : undefined,
      cloud: cloudEntry || client.cloud,
      saving: cloudBusy,
      creation,
      tab: xrTab,
      setTab: (tab) => {
        setXrTab(tab);
        if (tab !== "ai")
          workspace.reveal(
            tab === "sound" ? "listen" : tab === "name" ? "name:" : "shape:0",
          );
      },
      run: (value) => void runCreation(value),
      canFly: canCreateFlight,
      message: !canCreateFlight ? flightHelp : creationMessage,
      guide: creationGuide,
      voice: voiceControls,
      canAR: vr.canShowAR,
      ar: vrState.displayMode === "ar",
      home: () => {
        workspace.run("close");
        setPage("main");
      },
      exit: () => void vr.exit(),
      reconnect: disconnectedRoom
        ? () => {
            workspace.run("close");
            setPage("connection");
          }
        : undefined,
    });
  else if (shelfOpen) {
    const start =
      Math.min(shelfPage, Math.max(0, Math.ceil(library.length / 4) - 1)) * 4;
    const buttons = library.slice(start, start + 4).map(({ entry, place }) => ({
      label: `${start + library.slice(start, start + 4).findIndex((x) => x.entry === entry) + 1}. ${entry.name}（${place}）`,
      press: () => loadCreation(entry),
      enabled: true,
    }));
    buttons.push(
      {
        label: "前の4機",
        press: () => setShelfPage(Math.max(0, shelfPage - 1)),
        enabled: start > 0,
      },
      {
        label: "次の4機",
        press: () => setShelfPage(shelfPage + 1),
        enabled: start + 4 < library.length,
      },
      {
        label: "新しい一機をつくる",
        press: () => {
          setSwitchTarget({ entry: null });
        },
        enabled: true,
      },
      {
        label: "空のメニューに戻る",
        press: () => setShelfOpen(false),
        enabled: true,
      },
    );
    vr.sharedPanel = {
      title: client.cloud ? "クラウド格納庫" : "保存した機体",
      status: `${library.length}機 / ${Math.floor(start / 4) + 1} / ${Math.max(1, Math.ceil(library.length / 4))}ページ`,
      detail: "名前を押すと手元に模型を呼び出します。格納庫は各24機まで。",
      buttons: buttons.map((b, i) => ({
        ...b,
        x: 30 + (i % 2) * 497,
        y: 157 + Math.floor(i / 2) * 81,
        w: 467,
        h: 69,
      })),
    };
  }
  if (switchTarget) {
    const name = switchTarget.entry?.name ?? "新しい一機";
    const options = creation.dirty
      ? [
          { label: "保存して切り替える", press: () => void acceptSwitch(true) },
          {
            label: "保存せず切り替える",
            press: () => void acceptSwitch(false),
          },
          { label: "続けて編集する", press: cancelSwitch },
        ]
      : [
          { label: "この機体を使う", press: () => void acceptSwitch(false) },
          { label: "選び直す", press: () => setSwitchTarget(null) },
        ];
    vr.sharedPanel = {
      title: name,
      status: creation.dirty
        ? "今の機体に未保存の変更があります"
        : "この機体を呼び出しますか？",
      detail:
        creationMessage || "手元の模型で確認。飛行中の機体は変わりません。",
      buttons: options.map((b, i) => ({
        ...b,
        x: 30,
        y: 157 + i * 81,
        w: 964,
        h: 65,
      })),
    };
  }
  const guideAction = assistant.guide?.action;
  // Shared VR pages use one hierarchy. Creation and keyboard keep their purpose-built layout.
  if (!creation.open && !shelfOpen && !switchTarget) {
    const back = () => setPage("main");
    if (page === "voice")
      vr.sharedPanel = xrMenuPage({
        title: "AIと相談",
        status: voiceControls?.active
          ? "会話中"
          : "会話は必要なときに始められます",
        detail:
          voiceControls?.message ?? "機体の名前や、変えたいことを話せます。",
        actions: [
          {
            label: !voiceControls?.prepared
              ? "AIを準備する"
              : voiceControls.active
                ? "会話を終える"
                : "会話を始める",
            press: () =>
              !voiceControls?.prepared
                ? voiceControls?.prepare?.()
                : voiceControls.active
                  ? voiceControls.stop()
                  : voiceControls.start(),
            enabled:
              !!voiceControls &&
              (!voiceControls.prepared
                ? !!voiceControls.authorized
                : voiceControls.active || voiceControls.ready),
            role: "primary",
          },
          {
            label: voiceControls?.muted ? "マイクを戻す" : "マイクをミュート",
            press: () => voiceControls?.toggleMute(),
            enabled: !!voiceControls?.active,
          },
          { label: "機体を編集", press: openCreation },
        ],
        back,
      });
    if (page === "view")
      vr.sharedPanel = xrMenuPage({
        title: "音・見え方の設定",
        status:
          vrState.displayMode === "ar"
            ? "現実に重ねて表示中"
            : "仮想の空を表示中",
        detail: "指で触れる・離すと選択。左右の取っ手をつまむと盤を移動。",
        actions: [
          { label: "音量・聴き方", press: () => setPage("audio") },
          {
            label: audio.ambienceOn ? "風の環境音を止める" : "風の環境音を聴く",
            press: () => {
              audio.setAmbience(!audio.ambienceOn);
              e.notify();
            },
          },
          {
            label: audio.interfaceSoundOn ? "操作音を止める" : "操作音を鳴らす",
            press: () => {
              audio.interfaceSoundOn = !audio.interfaceSoundOn;
              e.notify();
            },
          },
          { label: "機体の選択を外す", press: clear },
          { label: "机と会場の位置合わせ", press: () => setPage("spatial") },
          {
            label: "ブラウザに戻る",
            press: () => void vr.exit(),
            role: "utility",
          },
        ],
        back,
      });
    if (page === "audio")
      vr.sharedPanel = xrMenuPage({
        title: "音量・聴き方",
        status: `音量 ${volume} / 70`,
        detail:
          audio.spaceSoundState.speaking && audio.speechDucking
            ? "AIの声が聞こえやすいよう、機体音を少し下げています。"
            : "この端末だけに反映します。音の厚みも比較できます。",
        actions: [
          {
            label: "音量 −5",
            press: () => setVolume((v) => Math.max(0, v - 5)),
          },
          {
            label: "音量 ＋5",
            press: () => setVolume((v) => Math.min(70, v + 5)),
          },
          {
            label: `聴く機器：${audio.outputProfile === "speaker" ? "本体スピーカー" : "ヘッドホン"}`,
            press: () => {
              audio.setOutputProfile(
                audio.outputProfile === "speaker" ? "headphones" : "speaker",
              );
              e.notify();
            },
          },
          {
            label: "音の表現・案内",
            role: "navigation",
            press: () => setPage("sound-detail"),
          },
          {
            label: resting ? "音を聴く" : "音を止める",
            press: () => (resting ? void listen() : rest()),
          },
          {
            label: "聴く機体を選ぶ",
            press: () => setPage("listening"),
            role: "navigation",
          },
        ],
        back: () => setPage("main"),
      });
    if (page === "sound-detail")
      vr.sharedPanel = xrMenuPage({
        title: "音の表現・案内",
        status: `軌跡：${TRACE_LABELS[e.soundTraceMode]}`,
        detail:
          "VRの空で、届いた音の位置に薄い厚みを表示します。ARでは機体だけを表示します。",
        actions: [
          ...(["soft", "line", "off"] as SoundTraceMode[]).map((mode) => ({
            label: TRACE_LABELS[mode],
            highlight: e.soundTraceMode === mode,
            press: () => e.setSoundTrace(mode),
          })),
          {
            label: `AI発話中の音量調整：${audio.speechDucking ? "オン" : "オフ"}`,
            press: () => {
              audio.setSpeechDucking(!audio.speechDucking);
              e.notify();
            },
          },
          {
            label: `風の環境音：${audio.ambienceOn ? "オン" : "オフ"}`,
            press: () => {
              audio.setAmbience(!audio.ambienceOn);
              e.notify();
            },
          },
          {
            label: `操作音：${audio.interfaceSoundOn ? "オン" : "オフ"}`,
            press: () => {
              audio.interfaceSoundOn = !audio.interfaceSoundOn;
              e.notify();
            },
          },
        ],
        back: () => setPage("audio"),
        backLabel: "音量・聴き方に戻る",
      });
    if (page === "fleet") {
      const start =
        Math.min(
          fleetPage,
          Math.max(0, Math.ceil(playback.names.length / 4) - 1),
        ) * 4;
      vr.sharedPanel = xrMenuPage({
        title: "飛行中・出発待ちの機体",
        status: `${playback.names.length}機 / ${Math.floor(start / 4) + 1}ページ`,
        detail: inspection?.visible
          ? `${playback.names.find((f) => f.id === selected)?.name ?? "機体"}：距離 ${Math.round(inspection.distanceM ?? 0)}m / 高さ ${Math.round(inspection.altitudeM ?? 0)}m`
          : "名前を選ぶと、その機体の距離や高さが分かります。",
        actions: [
          ...playback.names.slice(start, start + 4).map((f) => ({
            label: `${f.name} · ${now < f.startsAt ? `あと${Math.ceil((f.startsAt - now) / 1000)}秒で出発` : now < f.endsAt ? "飛行中" : "音の余韻"}`,
            press: () => setSelected(f.id as FlightId),
            highlight: selected === f.id,
          })),
          {
            label: "前の4機",
            press: () => setFleetPage(Math.max(0, fleetPage - 1)),
            enabled: start > 0,
            role: "navigation",
          },
          {
            label: "次の4機",
            press: () => setFleetPage(fleetPage + 1),
            enabled: start + 4 < playback.names.length,
            role: "navigation",
          },
        ],
        back,
      });
      vr.sharedPanel.buttons.push({
        label: "選んだ機体に指示",
        press: () => setPage("flight-control"),
        enabled: !!selected,
        x: 520,
        y: 351,
        w: 476,
        h: 56,
        role: "navigation",
      });
    }
    if (page === "listening")
      vr.sharedPanel = xrMenuPage({
        title: "聴く機体を選ぶ",
        status:
          playback.names.find((f) => f.id === selected)?.name ??
          "機体を選んでください",
        detail: "この端末だけの聴き方です。他の人の音は変わりません。",
        actions: [
          {
            label: "空全体を聴く",
            press: () => chooseMix("balanced"),
            highlight: e.mixMode === "balanced",
          },
          {
            label: "選んだ機体だけ聴く",
            press: () => chooseMix("solo"),
            enabled: !!selected,
            highlight: e.mixMode === "solo",
          },
          {
            label: "選んだ機体を強調",
            press: () => chooseMix("focus"),
            enabled: !!selected,
            highlight: e.mixMode === "focus",
          },
          {
            label: "飛行中の機体から選ぶ",
            press: () => setPage("fleet"),
            role: "navigation",
          },
        ],
        back: () => setPage("audio"),
        backLabel: "音量・聴き方に戻る",
      });
    if (page === "flight-control")
      vr.sharedPanel = xrMenuPage({
        title: "選んだ機体に指示",
        status:
          playback.names.find((f) => f.id === selected)?.name ??
          "先に機体を選んでください",
        detail:
          note ||
          "巡航中の航路を約2分だけ変更。近い機体があると変更を見送ります。",
        actions: [
          ...(
            [
              ["overhead", "頭上を飛んで"],
              ["wide", "広く回って"],
              ["higher", "少し高く飛んで"],
            ] as const
          ).map(([kind, label]) => ({
            label,
            press: () => void instructFlight(kind),
            enabled: !!selected && enabled,
          })),
          {
            label: "この機体だけ聴く",
            press: () => chooseMix("solo"),
            enabled: !!selected,
          },
          { label: "空全体を聴く", press: () => chooseMix("balanced") },
        ],
        back: () => setPage("fleet"),
        backLabel: "飛行中の機体に戻る",
      });
  }
  if (shelfOpen && !creation.open && !switchTarget && vr.sharedPanel) {
    vr.sharedPanel = xrMenuPage({
      ...vr.sharedPanel,
      actions: vr.sharedPanel.buttons.filter(
        (b) => !["新しい一機をつくる", "空のメニューに戻る"].includes(b.label),
      ),
      back: () => setShelfOpen(false),
    });
  }
  if (vr.sharedPanel)
    vr.sharedPanel.environment = {
      label: vrState.displayMode === "ar" ? "VRに戻る" : "ARで見る",
      enabled: vr.canShowAR,
      press: () => vr.toggleEnvironment(),
    };
  if (guideAction?.mode === "guide" && vr.sharedPanel && !switchTarget) {
    if (guideAction.control === "route" && page === "flight-control")
      vr.sharedPanel.guided = true;
    if (guideAction.control === "mix" && page === "listening")
      vr.sharedPanel.guided = true;
    if (
      guideAction.control === "menu" ||
      (guideAction.control === "hangar" && shelfOpen)
    )
      vr.sharedPanel.guided = true;
    if (
      ["volume", "sound", "settings"].includes(guideAction.control) &&
      page === "audio"
    ) {
      vr.sharedPanel.guided = guideAction.control === "settings";
      for (const b of vr.sharedPanel.buttons) {
        if (guideAction.control === "volume")
          b.highlight = b.label.startsWith(
            Number(guideAction.value) < volume ? "音量 −" : "音量 ＋",
          );
        if (guideAction.control === "sound")
          b.highlight = ["音を聴く", "この端末の音を止める"].includes(b.label);
      }
    }
  }
  return (
    <main
      className={`shared-app av-workbench wb-${desktopPlace}${visitor ? " visitor-app" : ""}`}
      onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest("button")) audio.feedback();
      }}
    >
      <header className="shared-header">
        <a href="./">音航跡 / AIRPLANEVOICE</a>
        <nav
          className="wb-navigation"
          aria-label="体験の場所"
          data-ai-control="menu"
        >
          {(
            [
              ["hangar", "格納庫"],
              ["edit", "つくる"],
              ["observe", "空を眺める"],
              ["operator", "部屋・運営"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-current={desktopPlace === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button onClick={openRadar}>フライトレーダー</button>
        <span className="wb-live-status">
          {room.status === "idle" ? "自分の一機から" : status}
        </span>
        {vrState.status !== "unsupported" && (
          <div className="wb-xr-entry">
            <button
              id="vr-enter"
              className="wb-primary"
              disabled={
                vrState.status !== "ready" && vrState.status !== "presenting"
              }
              onClick={() => {
                if (vr.active) void vr.exit();
                else {
                  void vr.enter(true);
                  void listen();
                }
              }}
            >
              {vr.active ? "ブラウザに戻る" : "VR / ARで体験する"}
            </button>
          </div>
        )}
      </header>
      <div className="shared-layout">
        {environmentOpen && desktopPlace === "observe" && !vr.active && (
          <EnvironmentPanel
            value={environmentDraft}
            set={setEnvironmentDraft}
            close={() => setEnvironmentOpen(false)}
            ready={enabled}
            consult={async text => voiceControls?.askText ? voiceControls.askText(`【景色案】${text}`.slice(0,500)) : "AIの準備中です。少し待ってからもう一度お試しください。"}
            message={note}
            apply={() => {
              const id = client.send({
                type: "environment",
                environment: environmentDraft,
              });
              setEnvironmentSubmission(id ?? null);
              setNote(
                id
                  ? "共有サーバーへ景色を送っています。"
                  : "共有に接続してから反映してください。",
              );
            }}
          />
        )}
        {radarOpen &&
          !vr.active &&
          (desktopPlace === "observe" || desktopPlace === "operator") && (
            <FlightRadar
              source={radarSource}
              close={() => setRadarOpen(false)}
            />
          )}
        <aside
          className="shared-controls"
          aria-label="共有する空の設定"
          hidden={desktopPlace !== "operator"}
        >
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
          {vrState.status !== "unsupported" && (
            <section className="xr-entry" aria-label="VRへの入口">
              <button
                id="operator-vr-enter"
                className="primary"
                disabled={
                  vrState.status !== "ready" && vrState.status !== "presenting"
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
                    : "VRで体験をはじめる"}
              </button>
              <p>
                {vrState.status === "checking"
                  ? "VRの対応状況を確認しています…"
                  : "名前や制作中の設定は、ブラウザへ戻っても引き継ぎます。"}
              </p>
              {vrState.error && <p role="alert">{vrState.error}</p>}
            </section>
          )}
          <div className="shared-actions creation-entry">
            <button className="primary" onClick={openCreation}>
              一機をつくる
            </button>
            <button onClick={openShelf}>保存した機体を呼び出す</button>
          </div>
          {creation.open && (
            <section className="model-controls" aria-label="模型の操作">
              <span>手元の模型</span>
              {[
                "左へ回す",
                "右へ回す",
                "大きく",
                "小さく",
                "手元へ戻す",
                "向きを戻す",
              ].map((label, i) => (
                <button
                  key={label}
                  onClick={() => vr.creationModel?.command(i)}
                >
                  {label}
                </button>
              ))}
            </section>
          )}
          {creation.open && (
            <CreationPanel
              state={creation}
              run={(value) => void runCreation(value)}
              patch={(r) => {
                try {
                  workspace.patch(r);
                } catch (error) {
                  setCreationMessage(String(error));
                }
              }}
              canFly={canCreateFlight}
              canShare={canShareCreation}
              message={
                creation.step === 3 && !canCreateFlight
                  ? flightHelp
                  : creationMessage || (creation.step === 3 ? flightHelp : "")
              }
              highlight={creationGuide}
            />
          )}
          {shelfOpen && (
            <section className="creation-shelf" aria-label="保存した機体一覧">
              <h2>保存した機体</h2>
              <p>この部屋の作品は、部屋の終了まで使えます。</p>
              {library.map(({ entry, place }, i) => (
                <button
                  key={`${place}-${entry.id}-${i}`}
                  onClick={() => loadCreation(entry)}
                >
                  {entry.name}（{place}）
                </button>
              ))}
              {!library.length && <p>まだ保存した機体がありません。</p>}
              <button
                onClick={() => {
                  workspace.fresh();
                  setShelfOpen(false);
                  setCreationMessage("");
                }}
              >
                新しい一機をつくる
              </button>
              <button onClick={() => setShelfOpen(false)}>一覧を閉じる</button>
            </section>
          )}
          {!room.state ? (
            <>
              {!visitor && !cloudEntry && !client.cloud && (
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
                <button onClick={client.reconnect}>
                  {client.cloud ? "展示空間に再接続" : "招待した部屋へ再接続"}
                </button>
              )}
            </>
          ) : (
            <>
              {!visitor && (
                <div className="shared-flight">
                  {room.state && (
                    <TrafficPanel
                      state={room.state}
                      now={now}
                      disabled={!enabled}
                      update={(settings) =>
                        client.send({ type: "traffic", settings })
                      }
                    />
                  )}
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
                <button
                  data-ai-control="sound"
                  onClick={() => (resting ? void listen() : rest())}
                >
                  {resting
                    ? visitor
                      ? "この画面で体験する"
                      : "音を聴く"
                    : "この端末の音を止める"}
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
              <RoomAlignmentStatus room={room} venue={venue} now={now} />
              <VenuePanel
                venue={venue}
                enabled={enabled}
                editable={!visitor}
                vr={vr}
                onSave={saveVenue}
                onLook={() => {
                  if (!vr.active) {
                    view.current.yaw = -0.35;
                    view.current.pitch = -0.6;
                  }
                }}
              />
              <details className="room-guide">
                <summary>Questでの操作案内</summary>
                <p>
                  指して親指と人差し指をつまむか、指先でボタンに触れて手前へ戻すと決定します。下のバーでメニューを開閉し、「手元へ呼ぶ」で位置を戻せます。
                </p>
                <p>
                  コントローラーではトリガーで決定、グリップでメニューを呼べます。机の枠の調整は指でも操作できます。
                </p>
                <p>
                  機体を指すと情報を表示。何もない場所を選ぶと解除します。音量や見え方は自分だけに反映します。
                </p>
                <p>
                  操作盤の「見え方・操作案内」から、対応端末では現実の景色に機体を重ねられます。まずは移動せず、周りに気を配って眺めてください。
                </p>
              </details>
              <label className="shared-volume" data-ai-control="settings">
                自分の音量 {volume}%
                <input
                  aria-label="自分の音量"
                  data-ai-control="volume"
                  type="range"
                  min="0"
                  max="70"
                  step="5"
                  value={volume}
                  onChange={(ev) => setVolume(+ev.target.value)}
                />
              </label>
              <div className="shared-actions">
                <button
                  data-ai-control="aircraft"
                  onClick={() => setSelected("ST-01")}
                >
                  機体情報
                </button>
                <button
                  onClick={look}
                  disabled={!aircraftInfo(e, "ST-01")?.visible}
                >
                  機体の方を向く
                </button>
              </div>
              {playback.names.length > 0 && (
                <div className="shared-actions" aria-label="今飛んでいる機体">
                  {playback.names.map(({ name, id }) => (
                    <button
                      key={id}
                      onClick={() => setSelected(id as FlightId)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
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
                  <CreationShelf
                    persistent={client.cloud}
                    recipe={recipe}
                    enabled={enabled}
                    onLoad={update}
                    shared={room.state?.hangar ?? []}
                    onPublish={(entry) =>
                      client.send({
                        type: "hangar-save",
                        entry,
                        expected:
                          client.snapshot.state?.hangar?.find(
                            (item) => item.id === entry.id,
                          ) ?? null,
                      })
                    }
                    onRemove={(entryId) =>
                      client.send({ type: "hangar-remove", entryId })
                    }
                    onLaunch={() => {
                      void listen();
                      client.send({ type: "launch-hangar" });
                    }}
                  />
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
                機体数は「空の運行管理」で調整できます。自分の休憩や退出でも、みんなの空は動き続けます。
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
            environment={
              environmentOpen && desktopPlace === "observe" && !vr.active
                ? environmentDraft
                : (room.state?.environment ?? DEFAULT_ENVIRONMENT)
            }
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
            venue={venue}
            airfield
            desktopPreview={
              vrState.status !== "presenting" &&
              background !== "live" &&
              (desktopPlace === "hangar" || desktopPlace === "edit")
                ? background
                : undefined
            }
            previewOffset={desktopPlace === "hangar" ? 0.25 : -0.08}
            creationDesign={
              !nameKeys &&
              (creation.open ||
                switchTarget?.entry ||
                (vrState.status !== "presenting" &&
                  (desktopPlace === "hangar" || desktopPlace === "edit")))
                ? (switchTarget?.entry ?? creation.entry).recipe.aircraft
                : undefined
            }
          />
          <div className="shared-caption">
            <div className="flight-roster" aria-label="飛行中・出発待ちの機体">
              {playback.names.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSelected(f.id as typeof e.focusId)}
                >
                  {f.name} ·{" "}
                  {now < f.startsAt
                    ? `出発まで${Math.ceil((f.startsAt - now) / 1000)}秒`
                    : now < f.endsAt
                      ? "飛行中"
                      : "音の余韻"}
                </button>
              ))}
            </div>
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
        {desktopPlace === "observe" && inspection && (
          <div className="wb-inspection">
            <div data-ai-control="mix">
              <button
                onClick={() => chooseMix("solo")}
                aria-pressed={e.mixMode === "solo"}
              >
                この機体だけ聴く
              </button>
              <button
                onClick={() => chooseMix("balanced")}
                aria-pressed={e.mixMode === "balanced"}
              >
                空全体を聴く
              </button>
            </div>
            <div data-ai-control="route">
              {(
                [
                  ["overhead", "頭上を飛んで"],
                  ["wide", "広く回って"],
                  ["higher", "少し高く飛んで"],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  disabled={!enabled}
                  onClick={() => void instructFlight(kind)}
                >
                  {label}
                </button>
              ))}
              <p role="status">{note}</p>
            </div>
            <AircraftInfo
              info={inspection}
              ids={e.flightIds}
              onSelect={setSelected}
              onClose={clear}
              onClear={clear}
              onLook={look}
            />
          </div>
        )}
        {desktopPlace === "observe" && !vr.active && (
          <div className="observer-tools">
            <button
              onClick={() => {
                setEnvironmentDraft(
                  structuredClone(
                    room.state?.environment ?? DEFAULT_ENVIRONMENT,
                  ),
                );
                setEnvironmentOpen(true);
              }}
            >
              空間づくり
            </button>
            {!visitor && (
              <button
                aria-pressed={freeView}
                onClick={(event) => {
                  event.currentTarget.blur();
                  if (!freeView) groundView.current = { ...e.listener };
                  else e.setListener(groundView.current);
                  view.current.free = !freeView;
                  setFreeView(!freeView);
                }}
              >
                {freeView ? "元の立ち位置へ戻る" : "PCの自由視点"}
              </button>
            )}
            {freeView && (
              <span>
                WASD：前後左右 / Q・E：下降・上昇 / ドラッグ：見回す /
                Shift：速く
              </span>
            )}
          </div>
        )}
        <Workbench
          soundDisplay={
            <>
              <label>
                音の軌跡{" "}
                <select
                  aria-label="音の軌跡"
                  value={e.soundTraceMode}
                  onChange={(event) =>
                    e.setSoundTrace(event.target.value as SoundTraceMode)
                  }
                >
                  {Object.entries(TRACE_LABELS).map(([key, label]) => (
                    <option value={key} key={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                aria-pressed={audio.speechDucking}
                onClick={() => {
                  audio.setSpeechDucking(!audio.speechDucking);
                  e.notify();
                }}
              >
                AI発話中の音量調整 {audio.speechDucking ? "オン" : "オフ"}
              </button>
            </>
          }
          ai={() => voiceControls?.show?.()}
          ambience={audio.ambienceOn}
          toggleAmbience={() => {
            audio.setAmbience(!audio.ambienceOn);
            void listen();
            repaint((v) => v + 1);
          }}
          interfaceSound={audio.interfaceSoundOn}
          toggleInterfaceSound={() => {
            audio.interfaceSoundOn = !audio.interfaceSoundOn;
            repaint((v) => v + 1);
          }}
          place={desktopPlace}
          navigate={navigate}
          category={category}
          setCategory={(value) => {
            setCategory(value);
            workspace.reveal(
              value === "name"
                ? "name:"
                : value === "sound"
                  ? "listen"
                  : "shape:0",
            );
          }}
          background={background}
          setBackground={setBackground}
          state={creation}
          library={library}
          cloud={cloudEntry || client.cloud}
          cloudSaved={cloudSaved}
          cloudBusy={cloudBusy}
          localOnlyCount={localOnly.length}
          uploadLocal={() => void uploadLocal()}
          run={(value) => void runCreation(value)}
          patch={(r) => {
            try {
              workspace.patch(r);
            } catch (error) {
              setCreationMessage(String(error));
            }
          }}
          select={loadCreation}
          fresh={() => setSwitchTarget({ entry: null })}
          message={
            room.error ||
            note ||
            vrState.error ||
            creationMessage ||
            (!canCreateFlight ? flightHelp : "")
          }
          canFly={canCreateFlight}
          canShare={canShareCreation}
          model={(i) => vr.creationModel?.command(i)}
          resting={resting}
          listen={() => void listen()}
          rest={rest}
          volume={volume}
          setVolume={setVolume}
          flightLabel={flightLabel}
          highlight={creationGuide}
        />
        {switchTarget && (
          <dialog
            ref={switchDialog}
            onCancel={() => setSwitchTarget(null)}
            className="wb-switch"
            role="dialog"
            aria-modal="true"
            aria-label="機体の切り替え"
          >
            <h2>{switchTarget.entry?.name ?? "新しい一機をつくる"}</h2>
            <p>
              {creation.dirty
                ? "今の機体に、まだ保存していない変更があります。"
                : "この機体を手元に呼び出します。"}
              <br />
              飛行中の機体は変わりません。
            </p>
            {creationMessage && <p role="status">{creationMessage}</p>}
            <div className="wb-switch-actions">
              {creation.dirty ? (
                <>
                  <button
                    className="wb-primary"
                    onClick={() => void acceptSwitch(true)}
                  >
                    保存して切り替える
                  </button>
                  <button onClick={() => void acceptSwitch(false)}>
                    保存せず切り替える
                  </button>
                </>
              ) : (
                <button
                  className="wb-primary"
                  onClick={() => void acceptSwitch(false)}
                >
                  この機体を使う
                </button>
              )}
              <button onClick={cancelSwitch}>
                {creation.dirty ? "続けて編集する" : "選び直す"}
              </button>
            </div>
          </dialog>
        )}
      </div>
      <div hidden={vrState.status === "presenting"}>
        <AiTrialPanel
          onSpeakingChange={audio.setSpeaking}
          onVoiceControls={setVoiceControls}
          integrated
          disabled={false}
          getContext={assistant.getContext}
          onAction={assistant.execute}
          onGuide={(kind) => {
            if (kind !== "none")
              void assistant.execute({
                mode: "guide",
                control: "volume",
                value: String(
                  Math.max(
                    0,
                    Math.min(70, volume + (kind === "volume-up" ? 5 : -5)),
                  ),
                ),
              });
          }}
        />
        {assistant.guide && (
          <AssistantGuide
            text={assistant.guide.text}
            onClose={assistant.clear}
          />
        )}
      </div>
    </main>
  );
}
