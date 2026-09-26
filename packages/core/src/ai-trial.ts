import { AIRCRAFT, MAX_AIRCRAFT } from "./airspace";
import {checkedEnvironment,type EnvironmentRecipe} from "./environment";
import {
  ASSISTANT_CONTROLS,
  type AssistantControl,
  type AssistantAction,
  type AssistantCommand,
} from "./assistant-actions";
import {
  DEFAULT_WORKSHOP,
  parseWorkshop,
  type AircraftDesign,
} from "./workshop";
/** Operator access. Null means no application-imposed usage limit. */
export const AI_TRIAL_LIMITS = {
  observations: null,
  replies: null,
  conversations: null,
  voiceSeconds: null,
  observationMs: 10_000,
  staleMs: 20_000,
} as const;
export const AI_GUIDES = ["none", "volume-up", "volume-down"] as const;
export type AiGuide = (typeof AI_GUIDES)[number];
export interface TrialContext {
  revision: number;
  phase: "EDIT" | "COMPILE" | "FLY" | "ARRIVAL" | "INTERLAP";
  paused: boolean;
  volume: number;
  soundOn: boolean;
  menuOpen: boolean;
  menuPage: "home" | "sound" | "view" | "help";
  selected: boolean;
  surface?: "desktop" | "shared";
  controls?: AssistantControl[];
  canEdit?: boolean;
  showActive?: boolean;
  settingsOpen?: boolean;
  workshopOpen?: boolean;
  ui?: {
    mode: "pc" | "vr" | "ar";
    place: "hangar" | "edit" | "observe" | "operator";
    tab: "dimensions" | "shape" | "color" | "sound" | "route" | "name" | "ai";
    panelTitle?: string;
    buttons?: string[];
    pendingAircraftId?: string;
    canFly: boolean;
    flightHelp: string;
  };
  hangar?: { id: string; name: string; place: string }[];
  creation?: {
    id?: string;
    aircraft?: AircraftDesign;
    open: boolean;
    step: number;
    name: string;
    dirty: boolean;
    lastAction: string;
  };
  selectedId?: string | null;
  mixMode?: "balanced" | "focus" | "solo";
  flightInstruction?: string;
  environment?: EnvironmentRecipe;
  fleet: {
    id: string;
    name?: string;
    sourceEntryId?: string;
    state: "waiting" | "flying" | "tail" | "complete";
    distanceM: number;
    pendingCount: number;
    radialMps?: number;
    signalDb?: number;
  }[];
}
export const isRecord = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const integer = (x: unknown, max: number): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0 && x <= max;
export function parseTrialContext(x: unknown): TrialContext {
  if (
    !isRecord(x) ||
    !integer(x.revision, Number.MAX_SAFE_INTEGER) ||
    !["EDIT", "COMPILE", "FLY", "ARRIVAL", "INTERLAP"].includes(
      String(x.phase),
    ) ||
    !["home", "sound", "view", "help"].includes(String(x.menuPage)) ||
    !integer(x.volume, 70) ||
    ![x.paused, x.soundOn, x.menuOpen, x.selected].every(
      (v) => typeof v === "boolean",
    ) ||
    !Array.isArray(x.fleet) ||
    x.fleet.length > MAX_AIRCRAFT
  )
    throw new Error("画面の状態を読み取れませんでした。");
  const fleet = x.fleet.map((f) => {
    if (
      !isRecord(f) ||
      !AIRCRAFT.some((a) => a.id === f.id) ||
      !["waiting", "flying", "tail", "complete"].includes(String(f.state)) ||
      !integer(f.distanceM, 100000) ||
      !integer(f.pendingCount, 100000)
    )
      throw new Error("機体の状態が不正です。");
    if (
      (f.radialMps !== undefined &&
        (typeof f.radialMps !== "number" ||
          !Number.isFinite(f.radialMps) ||
          Math.abs(f.radialMps) > 1000)) ||
      (f.signalDb !== undefined &&
        (typeof f.signalDb !== "number" ||
          !Number.isFinite(f.signalDb) ||
          f.signalDb < -120 ||
          f.signalDb > 20))
    )
      throw new Error("音の観測値が不正です。");
    return {
      id: f.id as string,
      ...(f.sourceEntryId === undefined
        ? {}
        : { sourceEntryId: boundedId(f.sourceEntryId) }),
      ...(f.name === undefined ? {} : { name: boundedText(f.name, 40) }),
      state: f.state as TrialContext["fleet"][number]["state"],
      distanceM: f.distanceM,
      pendingCount: f.pendingCount,
      ...(f.radialMps === undefined
        ? {}
        : { radialMps: f.radialMps as number }),
      ...(f.signalDb === undefined ? {} : { signalDb: f.signalDb as number }),
    };
  });
  if (new Set(fleet.map((f) => f.id)).size !== fleet.length)
    throw new Error("機体IDが重複しています。");
  if (
    x.surface !== undefined &&
    !["desktop", "shared"].includes(String(x.surface))
  )
    throw new Error("画面が不正です。");
  if (
    x.controls !== undefined &&
    (!Array.isArray(x.controls) ||
      x.controls.length > ASSISTANT_CONTROLS.length ||
      x.controls.some((v) => !ASSISTANT_CONTROLS.includes(v)))
  )
    throw new Error("操作一覧が不正です。");
  for (const key of ["canEdit", "showActive", "settingsOpen", "workshopOpen"])
    if (x[key] !== undefined && typeof x[key] !== "boolean")
      throw new Error("画面状態が不正です。");
  if (
    x.selectedId !== undefined &&
    x.selectedId !== null &&
    !fleet.some((f) => f.id === x.selectedId)
  )
    throw new Error("選択機体が不正です。");
  if (
    x.mixMode !== undefined &&
    !["balanced", "focus", "solo"].includes(String(x.mixMode))
  )
    throw new Error("聴き方が不正です。");
  let creation: TrialContext["creation"];
  if (x.creation !== undefined) {
    const v = x.creation;
    if (
      !isRecord(v) ||
      typeof v.open !== "boolean" ||
      typeof v.dirty !== "boolean" ||
      !integer(v.step, 3) ||
      typeof v.name !== "string" ||
      !v.name.trim() ||
      v.name.length > 40 ||
      typeof v.lastAction !== "string" ||
      v.lastAction.length > 1800
    )
      throw new Error("制作の状態が不正です。");
    creation = {
      ...(v.id === undefined ? {} : { id: boundedId(v.id) }),
      ...(v.aircraft === undefined
        ? {}
        : {
            aircraft: parseWorkshop(
              JSON.stringify({ ...DEFAULT_WORKSHOP, aircraft: v.aircraft }),
            ).aircraft,
          }),
      open: v.open,
      dirty: v.dirty,
      step: v.step,
      name: v.name,
      lastAction: v.lastAction,
    };
  }
  let hangar: TrialContext["hangar"];
  if (x.hangar !== undefined) {
    if (!Array.isArray(x.hangar) || x.hangar.length > 48)
      throw new Error("格納庫の情報が不正です。");
    hangar = x.hangar.map((item) => {
      if (!isRecord(item)) throw new Error("格納庫の機体が不正です。");
      return {
        id: boundedId(item.id),
        name: boundedText(item.name, 40),
        place: boundedText(item.place, 24),
      };
    });
    if (new Set(hangar.map((entry) => entry.id)).size !== hangar.length)
      throw new Error("格納庫IDが重複しています。");
  }
  let ui: TrialContext["ui"];
  if (x.ui !== undefined) {
    const u = x.ui;
    if (
      !isRecord(u) ||
      !["pc", "vr", "ar"].includes(String(u.mode)) ||
      !["hangar", "edit", "observe", "operator"].includes(String(u.place)) ||
      ![
        "shape",
        "dimensions",
        "color",
        "sound",
        "route",
        "name",
        "ai",
      ].includes(String(u.tab)) ||
      typeof u.canFly !== "boolean"
    )
      throw new Error("操作画面の情報が不正です。");
    ui = {
      ...(u.panelTitle === undefined
        ? {}
        : { panelTitle: boundedText(u.panelTitle, 120) }),
      ...(Array.isArray(u.buttons)
        ? { buttons: u.buttons.slice(0, 20).map((b) => boundedText(b, 80)) }
        : {}),
      mode: u.mode as NonNullable<TrialContext["ui"]>["mode"],
      place: u.place as NonNullable<TrialContext["ui"]>["place"],
      tab: u.tab as NonNullable<TrialContext["ui"]>["tab"],
      canFly: u.canFly,
      flightHelp: boundedText(u.flightHelp, 240),
      ...(u.pendingAircraftId === undefined
        ? {}
        : { pendingAircraftId: boundedId(u.pendingAircraftId) }),
    };
  }
  return {
    revision: x.revision,
    phase: x.phase as TrialContext["phase"],
    paused: x.paused as boolean,
    volume: x.volume,
    soundOn: x.soundOn as boolean,
    menuOpen: x.menuOpen as boolean,
    menuPage: x.menuPage as TrialContext["menuPage"],
    selected: x.selected as boolean,
    ...(x.surface === undefined
      ? {}
      : { surface: x.surface as TrialContext["surface"] }),
    ...(x.controls === undefined
      ? {}
      : { controls: [...new Set(x.controls as AssistantControl[])] }),
    ...(x.canEdit === undefined ? {} : { canEdit: x.canEdit as boolean }),
    ...(x.showActive === undefined
      ? {}
      : { showActive: x.showActive as boolean }),
    ...(x.settingsOpen === undefined
      ? {}
      : { settingsOpen: x.settingsOpen as boolean }),
    ...(x.workshopOpen === undefined
      ? {}
      : { workshopOpen: x.workshopOpen as boolean }),
    ...(x.selectedId === undefined
      ? {}
      : { selectedId: x.selectedId as string | null }),
    ...(x.mixMode === undefined
      ? {}
      : { mixMode: x.mixMode as TrialContext["mixMode"] }),
    ...(x.flightInstruction === undefined ? {} : { flightInstruction: boundedText(x.flightInstruction,16) }),
    ...(x.environment === undefined ? {} : {environment:checkedEnvironment(x.environment)}),
    fleet,
    ...(hangar ? { hangar } : {}),
    ...(ui ? { ui } : {}),
    ...(creation ? { creation } : {}),
  };
}
function boundedText(value: unknown, limit: number) {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new Error("表示名や画面情報が不正です。");
  return value;
}
function boundedId(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(value))
    throw new Error("格納庫のIDが不正です。");
  return value;
}
export function observationCandidates(c: TrialContext): Record<string, string> {
  const result: Record<string, string> = {
    quiet: c.paused
      ? "飛行を一時停止しています。"
      : c.phase === "EDIT"
        ? c.surface === "desktop"
          ? "出発前です。「この航路で飛ばす」から始められます。"
          : c.surface === "shared"
            ? "出発前です。運営が共有する空の飛行を準備します。"
            : "出発前です。メニューの「飛ばして眺める」から始められます。"
        : "空の変化を待っています。",
  };
  const flying = c.fleet
    .filter((f) => f.state === "flying")
    .sort((a, b) => a.distanceM - b.distanceM);
  if (flying[0] && !c.paused)
    result.aircraft = `${flying[0].name ?? flying[0].id} が飛行中です。観測位置から約${flying[0].distanceM}mにいます。`;
  const approach = flying.find((f) => (f.radialMps ?? 0) < -5);
  if (approach && !c.paused)
    result.approach = `${approach.name ?? approach.id}が観測位置へ近づいています。約${approach.distanceM}m先です。姿の接近と音の到来を比べられます。`;
  const signal = c.fleet.find((f) => (f.signalDb ?? -120) > -60);
  if (signal && c.soundOn && !c.paused)
    result.signal = `${signal.name ?? signal.id}の音声信号を端末内で検出しています。これはマイクで聴こえ方を測った結果ではありません。`;
  const pending = c.fleet.reduce((sum, f) => sum + f.pendingCount, 0);
  if (pending && !c.paused)
    result.sound = `まだ届いていない音の軌跡があります。${c.soundOn ? "この端末の音は再生中です。" : "音の再生は停止中です。「音を聴く」で開始できます。"}`;
  if (c.fleet.some((f) => f.state === "waiting"))
    result.waiting = "これから飛行する機体が待機しています。";
  return result;
}
export function validateObservation(
  raw: unknown,
  candidates: Record<string, string>,
): string | null {
  if (!isRecord(raw) || !isRecord(raw.answers) || !isRecord(raw.answers.focus))
    return null;
  const a = raw.answers.focus;
  if (
    a.type !== "choice" ||
    typeof a.choice !== "string" ||
    !Object.hasOwn(candidates, a.choice) ||
    !isRecord(a.probabilities)
  )
    return null;
  const values = Object.keys(candidates).map(
    (k) => a.probabilities && (a.probabilities as Record<string, unknown>)[k],
  );
  if (
    Object.keys(a.probabilities).length !== values.length ||
    !values.every(
      (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1,
    )
  )
    return null;
  const ps = values as number[];
  if (
    Math.abs(ps.reduce((a, b) => a + b, 0) - 1) > 0.01 ||
    (a.probabilities[a.choice] as number) < Math.max(...ps)
  )
    return null;
  return candidates[a.choice];
}
export function observationSuggestion(
  c: TrialContext,
  note: string,
): TrialStatus["observer"]["suggestion"] {
  if (!c.controls?.length) return undefined;
  const found = c.fleet.filter((f) => note.includes(f.name ?? f.id));
  const id = found.length === 1 ? found[0].id : undefined;
  if (id && c.controls.includes("aircraft"))
    return {
      label: `${found[0].name ?? id}を見る`,
      action: { mode: "apply", control: "aircraft", value: id },
    };
  if (!c.soundOn && c.controls.includes("sound"))
    return {
      label: "音の聴き方を教えて",
      action: { mode: "guide", control: "sound", value: "on" },
    };
  if (c.phase === "EDIT" && c.controls.includes("flight"))
    return {
      label: "飛ばし方を教えて",
      action: { mode: "guide", control: "flight", value: "start" },
    };
  return undefined;
}
export function nextVolumeStep(c: TrialContext, direction: "up" | "down") {
  if (direction === "up" && c.volume >= 70) return "音量は上限の70%です。";
  if (direction === "down" && c.volume <= 0) return "音量は最小の0%です。";
  if (c.surface)
    return "音量の操作場所を枠で示します。スライダーで好みの音量に変えられます。";
  if (!c.menuOpen) return "下のバーの「メニュー」を押してください。";
  if (c.menuPage === "sound")
    return `「音量を${direction === "up" ? "上げる" : "下げる"}」を押してください。`;
  return c.menuPage === "home"
    ? "「聴き方」を押してください。"
    : "「メニューに戻る」を押してください。";
}
export function contextSummary(c: TrialContext) {
  const focused = c.fleet.find((f) => f.id === c.selectedId);
  const place = c.ui
    ? `画面=${c.ui.mode}/${c.ui.place}/${c.ui.tab}。実際のパネル=${JSON.stringify(c.ui.panelTitle ?? "")}。`
    : "";
  const selection = focused
    ? `選択機体=${JSON.stringify(focused.name ?? "旅客機")}（${focused.id}）、${focused.state}、距離${focused.distanceM}m。`
    : "選択機体なし。";
  const creation = c.creation
    ? `編集下書き=${JSON.stringify(c.creation.name)}、${c.creation.open ? "表示中" : "閉じている"}。`
    : "";
  const buttons = c.ui?.buttons?.length
    ? `今押せるボタン=${c.ui.buttons.map((b) => JSON.stringify(b)).join("、")}。`
    : "";
  return `${place}${selection}${creation}${buttons}音量${c.volume}%、音${c.soundOn ? "再生中" : "停止中"}。空には${c.fleet.length}機。${Object.values(observationCandidates(c)).join(" ")}`;
}
export interface TrialReply {
  text: string;
  guide: AiGuide;
  revision: number;
  action?: AssistantAction;
  command?: AssistantCommand;
}
export interface TrialStatus {
  enabled: boolean;
  expiresAt: string | null;
  configured: { openai: boolean; typesafe: boolean };
  limits: typeof AI_TRIAL_LIMITS;
  used: { observations: number; replies: number; conversations: number };
  observer: {
    on: boolean;
    note: string;
    at: number;
    error: string;
    waiting?: boolean;
    suggestion?: { label: string; action: AssistantAction };
  };
  live: {
    status:
      | "idle"
      | "creating"
      | "active"
      | "closing"
      | "closed"
      | "unconfirmed"
      | "failed";
    deadline: number | null;
    seconds: number | null;
    error: string;
    endReason?: string;
  };
  reply: (TrialReply & { id: string }) | null;
}
