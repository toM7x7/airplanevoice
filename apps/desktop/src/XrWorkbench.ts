import type { SharedVrPanel } from "./vr";
import type { CreationState } from "../../../packages/core/src/creation";
import { AIRCRAFT_COLORS } from "../../../packages/core/src/creation";
import { AIRCRAFT_PATTERNS } from "../../../packages/core/src/show";
import type { VoiceControls } from "./ai/AiTrialPanel";

export type XrTab = "shape" | "dimensions" | "color" | "sound" | "name" | "ai";
export function xrWorkbench(input: {
  patternPage?: number;
  nextPatterns?: () => void;
  creation: CreationState;
  tab: XrTab;
  setTab: (tab: XrTab) => void;
  run: (value: string) => void;
  canFly: boolean;
  message: string;
  guide?: string;
  voice: VoiceControls | null;
  canAR: boolean;
  ar: boolean;
  home: () => void;
  exit: () => void;
  reconnect?: () => void;
  saveStatus?: string;
  cloud?: boolean;
  saving?: boolean;
}): SharedVrPanel {
  const { creation: c, tab, run, voice } = input;
  const buttons: SharedVrPanel["buttons"] = [];
  const add = (
    label: string,
    press: () => void,
    x: number,
    y: number,
    w: number,
    h: number,
    role = "choice",
    enabled = true,
    highlight = false,
  ) => buttons.push({ label, press, x, y, w, h, role, enabled, highlight });
  const tabs: [XrTab, string][] = [
    ["shape", "形"],
    ["dimensions", "寸法"],
    ["color", "尾翼の色"],
    ["sound", "音"],
    ["name", "名前"],
    ["ai", "AI相談"],
  ];
  tabs.forEach(([key, label], i) =>
    add(
      `${tab === key ? "✓ " : ""}${label}`,
      () => input.setTab(key),
      28 + i * 164,
      144,
      148,
      42,
      "navigation",
      true,
      tab === key,
    ),
  );
  let choices: { label: string; value: string }[] = [];
  if (tab === "dimensions") {
    const a = c.entry.recipe.aircraft;
    choices = [
      { label: "胴体 −2m", value: `body:${Math.max(50, a.bodyLengthM - 2)}` },
      { label: "胴体 ＋2m", value: `body:${Math.min(85, a.bodyLengthM + 2)}` },
      { label: "翼幅 −2m", value: `wings:${Math.max(45, a.wingSpanM - 2)}` },
      { label: "翼幅 ＋2m", value: `wings:${Math.min(85, a.wingSpanM + 2)}` },
    ];
  }
  if (tab === "shape")
    choices = AIRCRAFT_PATTERNS.slice((input.patternPage??0)*3,(input.patternPage??0)*3+3).map((p, i) => ({
      label: p.name,
      value: `shape:${i+(input.patternPage??0)*3}`,
    }));
  if (tab === "color")
    choices = AIRCRAFT_COLORS.slice((input.patternPage??0)*3,(input.patternPage??0)*3+3).map((p, i) => ({
      label: `${p.name}${c.entry.recipe.aircraft.color === p.color ? " ✓" : ""}`,
      value: `color:${i+(input.patternPage??0)*3}`,
    }));
  if (tab === "sound")
    choices = [
      { label: "今の音を聴く", value: "listen" },
      { label: "基準 → 今の音", value: "compare" },
      { label: "深い旅客機の響き", value: "tone:0" },
    ];
  if (tab === "name")
    choices = [
      { label: "キーボードで入力", value: "keyboard" },
      { label: "そら", value: "name:そら" },
      { label: "かなた", value: "name:かなた" },
    ];
  choices.forEach((b, i) =>
    add(
      b.label,
      () => run(b.value),
      28 + i * (984 / choices.length),
      201,
      984 / choices.length - 16,
      66,
      "choice",
      true,
      input.guide === b.value,
    ),
  );
  if (tab === "ai") {
    add(
      !voice?.prepared
        ? "AIを準備する"
        : voice.active
          ? "会話を終える"
          : "GPTライブで相談",
      () =>
        !voice?.prepared
          ? voice?.prepare?.()
          : voice.active
            ? voice.stop()
            : voice.start(),
      28,
      201,
      476,
      66,
      "choice",
      !!voice &&
        (!voice.prepared ? !!voice.authorized : voice.active || voice.ready),
    );
    add(
      voice?.muted ? "マイクを戻す" : "マイクをミュート",
      () => voice?.toggleMute(),
      520,
      201,
      476,
      66,
      "choice",
      !!voice?.active,
    );
  }
  add("模型の位置・大きさ", () => run("model"), 28, 281, 312, 42, "utility");
  add(
    input.cloud ? "クラウドに保存" : "この機体を保存",
    () => run("save"),
    356,
    281,
    312,
    42,
    "utility",
    !input.saving,
    input.guide === "save",
  );
  add(tab==="shape"||tab==="color"?"別の3パターン":"変更をひとつ戻す", tab==="shape"||tab==="color"?()=>input.nextPatterns?.():() => run("undo"), 684, 281, 312, 42, "utility");
  add("空のメニューに戻る", input.home, 28, 351, 476, 56, "navigation");
  add(
    input.reconnect ? "部屋に再接続" : "この機体を飛ばす",
    input.reconnect ?? (() => run("fly")),
    520,
    337,
    476,
    70,
    "primary",
    !!input.reconnect || input.canFly,
    input.guide === "fly",
  );
  return {
    layout: "authored",
    title: `機体をつくる · ${tabs.find((t) => t[0] === tab)?.[1]}`,
    status: `${c.entry.name}　${input.saveStatus ?? (c.dirty ? "変更あり" : "保存済み")}　${voice?.active ? " / AIと会話中" : ""}`,
    detail:
      tab === "dimensions"
        ? `胴体 ${c.entry.recipe.aircraft.bodyLengthM}m ／ 翼幅 ${c.entry.recipe.aircraft.wingSpanM}m · 空の飛行は続きます`
        : tab === "ai"
          ? (voice?.message ?? "AI接続を確認しています。")
          : input.message ||
            "正面の機体をつまんで回せます。編集途中でも飛ばせます。",
    buttons,
  };
}
