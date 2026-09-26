import type { TrialContext } from "./ai-trial";
import { isCreationAction, AIRCRAFT_COLORS, SOUND_CHOICES } from "./creation";
import { AIRCRAFT_PATTERNS } from "./show";
import { AIRCRAFT } from "./airspace";
import {
  changeEnvironment,
  DEFAULT_ENVIRONMENT,
  ENVIRONMENT_PRESETS,
} from "./environment";

export const ASSISTANT_CONTROLS = [
  "volume",
  "sound",
  "flight",
  "aircraft",
  "mix",
  "fleet",
  "settings",
  "workshop",
  "creation",
  "hangar",
  "menu",
  "route",
  "environment",
] as const;
export type AssistantControl = (typeof ASSISTANT_CONTROLS)[number];
export interface AssistantAction {
  mode: "guide" | "apply";
  control: AssistantControl;
  value: string;
}
export interface AssistantCommand {
  id: string;
  action: AssistantAction;
  expiresAt: number;
}
export const CONTROL_LABELS: Record<AssistantControl, string> = {
  volume: "音量",
  sound: "音の再生",
  flight: "飛行",
  aircraft: "機体情報",
  mix: "聴き方",
  fleet: "飛ばす機数",
  settings: "音と表示の設定",
  workshop: "つくる実験室",
  creation: "一機をつくる",
  hangar: "保存した機体",
  menu: "操作メニュー",
  route: "選んだ機体の飛び方",
  environment: "空間づくり",
};
export function parseAssistantAction(raw: unknown): AssistantAction {
  if (!raw || typeof raw !== "object")
    throw new Error("操作の形式を確認できませんでした。");
  const a = raw as Record<string, unknown>;
  if (
    !["guide", "apply"].includes(String(a.mode)) ||
    !ASSISTANT_CONTROLS.includes(a.control as AssistantControl) ||
    typeof a.value !== "string"
  )
    throw new Error("対応していない操作です。");
  const action = {
    mode: a.mode,
    control: a.control,
    value: a.value,
  } as AssistantAction;
  const values: Record<AssistantControl, (s: string) => boolean> = {
    volume: (s) => /^(?:[0-9]|[1-6][0-9]|70)$/.test(s),
    sound: (s) => ["on", "off"].includes(s),
    flight: (s) => ["start", "pause", "resume"].includes(s),
    aircraft: (s) => s === "none" || AIRCRAFT.some((a) => a.id === s),
    mix: (s) => ["balanced", "focus", "solo"].includes(s),
    route: (s) => ["overhead", "wide", "higher"].includes(s),
    environment: (s) => {
      try {
        changeEnvironment(DEFAULT_ENVIRONMENT, s);
        return true;
      } catch {
        return false;
      }
    },
    fleet: (s) => /^[123]$/.test(s),
    settings: (s) => s === "open",
    workshop: (s) => s === "open",
    creation: isCreationAction,
    hangar: (s) => s === "open" || /^load:[a-zA-Z0-9-]{8,80}$/.test(s),
    menu: (s) =>
      [
        "new",
        "hangar",
        "edit",
        "observe",
        "shape",
        "dimensions",
        "color",
        "sound",
        "name",
        "route",
      ].includes(s),
  };
  if (!values[action.control](action.value))
    throw new Error("設定値が範囲外です。");
  return action;
}
/** Rechecked at execution time; a model cannot create capabilities. */
export function actionProblem(
  a: AssistantAction,
  c: TrialContext,
): string | null {
  if (!c.controls?.includes(a.control)) return "この画面では使えない操作です。";
  if (c.ui?.pendingAircraftId)
    return "機体の切り替え確認中です。先に画面で保存するか、編集を続けるかを選んでください。";
  if (a.control === "environment" && c.ui?.mode !== "pc")
    return "景色の細かな制作はPCの空間づくりで行います。共有した景色はVRにも反映されます。";
  if (
    (a.control === "route" ||
      (a.control === "mix" && a.value !== "balanced")) &&
    !c.fleet.some((f) => f.id === c.selectedId && f.state === "flying")
  )
    return "先に飛行中の機体を名前で選んでください。";
  if (
    a.control === "hangar" &&
    a.value.startsWith("load:") &&
    !c.hangar?.some((entry) => entry.id === a.value.slice(5))
  )
    return "その機体は格納庫にありません。最新の名前一覧から選んでください。";
  if (a.control === "menu" && a.value === "route" && c.ui?.mode !== "pc")
    return "航路の細かな編集はPCからできます。VRでは形・色・音・名前を編集できます。";
  if (
    a.control === "aircraft" &&
    a.value !== "none" &&
    !c.fleet.some((f) => f.id === a.value)
  )
    return "その機体は今の空にいません。";
  if (a.control === "workshop" && c.phase !== "EDIT")
    return "飛行中です。航路を描き直す画面で実験室を開けます。";
  if (a.mode === "guide") return null;
  if (a.control === "creation" && ["save", "share", "fly"].includes(a.value))
    return "保存・共有・飛行の最終決定は利用者がボタンで行います。guideで案内してください。";
  if (a.control === "fleet" && (!c.canEdit || c.showActive))
    return "機数は単体の編集画面で変更できます。";
  if (a.control === "flight") {
    if (a.value === "start" && !["EDIT", "INTERLAP"].includes(c.phase))
      return "すでに飛行を始めています。";
    if (a.value !== "start" && ["EDIT", "INTERLAP"].includes(c.phase))
      return "今は飛行の開始前です。";
  }
  return null;
}
export function actionAchieved(a: AssistantAction, c: TrialContext): boolean {
  if (a.mode === "guide") return true;
  switch (a.control) {
    case "volume":
      return c.volume === Number(a.value);
    case "sound":
      return c.soundOn === (a.value === "on");
    case "aircraft":
      return (c.selectedId ?? "none") === a.value;
    case "mix":
      return c.mixMode === a.value;
    case "route":
      return c.flightInstruction === a.value;
    case "environment":
      if(a.value.startsWith("recipe:")) {
        const expected=changeEnvironment(DEFAULT_ENVIRONMENT,a.value);
        return !!c.environment && Object.entries(expected).every(([k,v])=>c.environment?.[k as keyof typeof expected]===v);
      }
      if(a.value.startsWith("name:"))return c.environment?.name===a.value.slice(5).trim();
      if(a.value.startsWith("buildingSound:"))return c.environment?.buildingSound===a.value.endsWith(":on");
      return (
        !!c.environment &&
        (a.value in ENVIRONMENT_PRESETS
          ? c.environment.preset === a.value
          : Number(a.value.split(":")[1]) ===
            c.environment[a.value.split(":")[0] as "density"])
      );
    case "fleet":
      return c.fleet.length === Number(a.value);
    case "flight":
      return a.value === "pause"
        ? c.paused
        : !c.paused && !["EDIT", "INTERLAP"].includes(c.phase);
    case "settings":
      return c.settingsOpen === true;
    case "workshop":
      return c.workshopOpen === true;
    case "creation":
      return c.creation?.lastAction === a.value;
    case "hangar":
      return a.value === "open"
        ? c.ui?.place === "hangar"
        : c.creation?.id === a.value.slice(5) ||
            c.ui?.pendingAircraftId === a.value.slice(5);
    case "menu":
      if (a.value === "dimensions" && c.ui?.mode === "pc")
        return c.ui.place === "edit" && c.ui.tab === "shape";
      if (a.value === "new") return c.ui?.pendingAircraftId === "new-aircraft";
      return ["hangar", "edit", "observe"].includes(a.value)
        ? c.ui?.place === a.value
        : c.ui?.place === "edit" && c.ui.tab === a.value;
  }
}
export function actionResult(
  a: AssistantAction,
  c: TrialContext,
  ok: boolean,
): string {
  if (!ok)
    return `${CONTROL_LABELS[a.control]}の操作は完了していません。画面の案内を確認してください。`;
  if (a.mode === "guide")
    return a.control === "creation" && a.value === "fly"
      ? `「${c.creation?.name ?? "編集中の機体"}」の出発ボタンを示しました。${c.ui?.canFly === false ? c.ui.flightHelp : "本人がボタンを押すと出発します。"}`
      : `${CONTROL_LABELS[a.control]}の操作場所を枠で示しました。枠のある場所を操作できます。`;
  if (a.control === "hangar") {
    if (a.value === "open")
      return c.hangar?.length
        ? "格納庫を開きました。どの機体を使いますか？ 一覧の名前で教えてください。"
        : "格納庫を開きました。保存した機体はまだありません。新しい一機を一緒につくりますか？";
    const name =
      c.hangar?.find((entry) => entry.id === a.value.slice(5))?.name ??
      "選んだ機体";
    return c.ui?.pendingAircraftId
      ? `「${name}」への切り替え確認を開きました。未保存の変更があるため、保存するかを画面で選んでください。機体はまだ切り替えていません。`
      : `「${name}」を編集用に呼び出しました。飛行はまだ開始していません。`;
  }
  if (a.control === "menu" && a.value === "new")
    return "新しい機体へ切り替える確認を開きました。画面で選んでください。";
  if (a.control === "menu")
    return `${MENU_LABELS[a.value as keyof typeof MENU_LABELS]}を開きました。`;
  if (a.control === "volume") return `この端末の音量を${c.volume}%にしました。`;
  if (a.control === "route")
    return "選んだ機体への指示を共有サーバーが受け付けました。5秒後から滑らかに航路を変え、約2分で元の航路へ戻ります。";
  if (a.control === "environment")
    return "このPCの景色の下書きを変えました。確認して『みんなの空に反映』を押すとQuestにも反映されます。";
  if (a.control === "creation")
    return a.value === "close"
      ? "制作を閉じました。下書きは残っています。"
      : `「${c.creation?.name ?? ""}」の制作に反映しました。手順は${(c.creation?.step ?? 0) + 1}/4です。保存・飛行は利用者が決定します。`;
  if (a.control === "fleet")
    return `次に飛ばす機体を${c.fleet.length}機にしました。`;
  if (a.control === "aircraft")
    return a.value === "none"
      ? "機体の選択を解除しました。"
      : `「${c.fleet.find((f) => f.id === a.value)?.name ?? a.value}」の情報を表示しました。`;
  if (a.control === "mix")
    return a.value === "balanced"
      ? "空全体を聴く設定にしました。"
      : "注目機を聴く設定にしました。";
  if (a.control === "sound")
    return a.value === "on"
      ? "この端末の音の再生を有効にしました。"
      : "この端末の音の再生を止めました。";
  if (a.control === "flight")
    return a.value === "pause"
      ? "飛行を一時停止しました。"
      : "飛行を開始・再開しました。";
  return `${CONTROL_LABELS[a.control]}を開きました。`;
}
export const ASSISTANT_TOOL = {
  type: "function",
  name: "control_sky",
  strict: true,
  description:
    "今の画面の操作を案内、または利用者が明確に頼んだ設定を変更する。手順・どこ・教えてはguide、変更して・開いてはapply。creationで形・音・名前の下書きを一緒に作れる。creationのsave/share/flyは必ずguideにし、利用者がボタンで最終決定する。変更結果は画面からの報告を待つ。1回に1操作。",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ["guide", "apply"] },
      control: { type: "string", enum: ASSISTANT_CONTROLS },
      value: {
        type: "string",
        description:
          "menu:new/hangar/edit/observe/shape/dimensions/color/sound/name/route(PCの下書き航路)。hangar:open または load:格納庫の実在ID。aircraft:ST-01〜ST-24/none（飛行中の情報選択。名前はscreen.fleetから照合）。volume:0〜70、sound:on/off、flight:start/pause/resume、mix:balanced(全体)/focus(強調)/solo(選択機だけ)、route:overhead(頭上通過)/wide(広く回る)/higher(少し高く)。routeは選択中の巡航機への約2分の指示。変更先の近接検査により断られる場合がある。fleet:1/2/3、settings/workshop:open。creation:open/close/restart/next/back/undo/listen/compare、shape:0〜5、body:50〜85、wings:45〜85、width:4.5〜8、sweep:20〜38、engineSize:0.8〜1.3、winglet:0〜3、engines:2/4、paint:#RRGGBB(胴体色)、accent:#RRGGBB(尾翼色)、design:AircraftDesignのJSON(下書きのみ)、color:0(青緑)/1(金色)/2(赤)/3(紺)/4(紫)/5(緑)、tone:0(重く深い)/1(深い＋ファン)/2(深い＋気流)、name:任意の40字以内、save/share/fly(guideのみ)。",
      },
    },
    required: ["mode", "control", "value"],
  },
} as const;

export const MENU_LABELS = {
  new: "新しい機体をつくる",
  hangar: "格納庫",
  edit: "機体の編集",
  observe: "空を眺める",
  shape: "形",
  dimensions: "寸法",
  color: "尾翼の色",
  sound: "機体の音",
  name: "名前",
  route: "航路",
} as const;
/** The backend receives the same capabilities that the client accepts. */
export function assistantMenu(c: TrialContext) {
  return {
    currentPanel: c.ui?.panelTitle,
    visibleButtons: c.ui?.buttons,
    selectedAircraft: c.fleet.find((f) => f.id === c.selectedId) ?? null,
    environment: c.controls?.includes("environment")
      ? {
          draft: c.environment,
          presets: ENVIRONMENT_PRESETS,
          parameters: {
            density: "0〜1",
            heightM: "4〜120m",
            streetWidthM: "20〜100m",
            greenery: "0〜1",
            seed: "0〜9999整数",
          },
          instruction:
            "environmentのvalueはpresetのキーまたはパラメーター名:数値。name:任意の40字以内、buildingSound:on/offも可。PCの下書きだけ変更。共有は利用者が画面で確定。",
        }
      : undefined,
    pages: c.controls?.includes("menu")
      ? Object.entries(MENU_LABELS)
          .filter(([key]) => key !== "route" || c.ui?.mode === "pc")
          .map(([value, label]) => ({
            label:
              c.ui?.mode !== "pc"
                ? ((
                    {
                      hangar: "保存した機体",
                      edit: "機体を編集",
                      observe: "空のメニューに戻る",
                    } as Record<string, string>
                  )[value] ?? label)
                : label,
            control: "menu",
            value,
          }))
      : [],
    aircraft:
      c.hangar?.map((entry) => ({
        ...entry,
        control: "hangar",
        value: `load:${entry.id}`,
      })) ?? [],
    editing: c.controls?.includes("creation")
      ? {
          dimensions: {
            body: "50〜85m",
            wings: "45〜85m",
            width: "4.5〜8m",
            sweep: "20〜38度",
            engineSize: "0.8〜1.3倍",
            winglet: "0〜3m",
            engines: "2/4",
            paint: "#RRGGBB 胴体",
            accent: "#RRGGBB 尾翼",
            design:
              "design:JSON でaircraft全体を一括下書き。bodyLengthM,wingSpanM,engineCount必須、bodyWidthM,wingSweepDeg,engineScale,wingletHeightM,color,bodyColor,sound任意。",
          },
          shapes: AIRCRAFT_PATTERNS.map((p, i) => ({
            label: p.name,
            control: "creation",
            value: `shape:${i}`,
          })),
          colors: AIRCRAFT_COLORS.map((p, i) => ({
            label: p.name,
            control: "creation",
            value: `color:${i}`,
          })),
          sounds: SOUND_CHOICES.map((p, i) => ({
            label: p.name,
            control: "creation",
            value: `tone:${i}`,
          })),
          name: {
            control: "creation",
            value: "name:希望する名前",
            maxLength: 40,
          },
          final: [
            {
              label: "この機体を飛ばす",
              mode: "guide",
              control: "creation",
              value: "fly",
            },
            {
              label: "保存",
              mode: "guide",
              control: "creation",
              value: "save",
            },
          ],
        }
      : undefined,
    workflow:
      "機体が未指定なら名前を確認する。格納庫からload→必要な編集項目を開く→下書きを変更→creation flyのguide。未保存切替の確認中は利用者の決定を待つ。保存と飛行は本人がボタンで最終決定。",
  };
}
