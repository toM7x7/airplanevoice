import { useEffect, useState } from "react";
import { AIRCRAFT_PATTERNS } from "../../../packages/core/src/show";
import {
  CREATION_STEPS,
  AIRCRAFT_COLORS,
  SOUND_CHOICES,
  type CreationState,
} from "../../../packages/core/src/creation";
import { DEFAULT_SOUND } from "../../../packages/core/src/sound-design";
import type { WorkshopRecipe } from "../../../packages/core/src/workshop";
import type { SharedVrPanel } from "./vr";
export function creationButtons(
  c: CreationState,
  run: (value: string) => void,
  canFly: boolean,
  canShare = canFly,
) {
  const choices =
    c.step === 0
      ? AIRCRAFT_PATTERNS.slice(0,3).map((p, i) => ({
          label: p.name,
          value: `shape:${i}`,
        }))
      : c.step === 1
        ? SOUND_CHOICES.map((p, i) => ({ label: p.name, value: `tone:${i}` }))
        : c.step === 2
          ? ["そら", "かなた", "こだま"].map((n) => ({
              label: n,
              value: `name:${n}`,
            }))
          : [
              { label: "この機体を保存", value: "save" },
              { label: "この機体を飛ばす", value: "fly" },
              { label: "この部屋へ渡す", value: "share" },
            ];
  return [
    ...choices,
    ...(c.step === 0
      ? AIRCRAFT_COLORS.slice(0,3).map((p, i) => ({
          label: `尾翼：${p.name}${c.entry.recipe.aircraft.color === p.color ? " ✓" : ""}`,
          value: `color:${i}`,
        }))
      : []),
    ...(c.step === 1
      ? [
          { label: "今の音を聴く", value: "listen" },
          { label: "基準 → 今の音を比較", value: "compare" },
        ]
      : []),
    { label: "変更をひとつ戻す", value: "undo" },
    {
      label: c.step === 3 ? "形を見直す" : "次へ",
      value: c.step === 3 ? "restart" : "next",
    },
    { label: "前の手順へ", value: "back" },
    { label: "閉じて眺める", value: "close" },
  ].map((b) => ({
    ...b,
    role: ["next", "fly"].includes(b.value)
      ? "primary"
      : ["back", "restart"].includes(b.value)
        ? "navigation"
        : ["undo", "close"].includes(b.value)
          ? "utility"
          : "choice",
    enabled:
      b.value === "back"
        ? c.step > 0
        : b.value === "fly"
          ? canFly
          : b.value === "share"
            ? canShare
            : true,
    press: () => run(b.value),
  }));
}
export function creationVrPanel(
  c: CreationState,
  run: (value: string) => void,
  canFly: boolean,
  message: string,
  highlight?: string,
  canShare = canFly,
  canAR = false,
  isAR = false,
): SharedVrPanel {
  return {
    layout: "authored",
    title: `一機をつくる / ${c.step + 1} / 4　${CREATION_STEPS[c.step]}`,
    status: `${c.entry.name}：${CREATION_STEPS[c.step]}`,
    detail:
      message ||
      (c.step === 1
        ? "旅客機の深い響きを使います。そのまま「次へ」で進めます。"
        : c.step === 3
          ? "飛ばすと部屋にも登録されます。保存は必要なときだけ。"
          : c.step === 0
            ? "左列で形、右列で尾翼の色を選びます。選んだ色には✓が付きます。"
            : "手元の模型で試す。飛行中の機体は実寸です。"),
    buttons: [
      {
        label: isAR ? "VRに戻る" : "ARで見る",
        value: "environment",
        role: "utility",
        enabled: canAR,
        press: () => run("environment"),
      },
      ...(c.step === 3
        ? [
            {
              label: "ARで眺める",
              value: "observe-ar",
              role: "choice",
              enabled: canAR,
              press: () => run("observe-ar"),
            },
          ]
        : []),
      {
        label: "模型を動かす",
        value: "model",
        role: "utility",
        enabled: true,
        press: () => run("model"),
      },
      ...creationButtons(c, run, canFly, canShare).filter(
        (b) =>
          !["tone:1", "tone:2", "compare", "share", "undo"].includes(b.value),
      ),
      ...(c.step === 2
        ? [
            {
              label: "VR内で名前を入力",
              value: "keyboard",
              role: "choice",
              enabled: true,
              press: () => run("keyboard"),
            },
          ]
        : []),
    ]
      .map((b, i, all) => {
        const choiceIndex = all
          .slice(0, i)
          .filter((x) => x.role === "choice").length;
        const colorIndex = b.value.startsWith("color:")
          ? Number(b.value.split(":")[1])
          : -1;
        const shapeIndex = b.value.startsWith("shape:")
          ? Number(b.value.split(":")[1])
          : -1;
        const position =
          c.step === 0 && (colorIndex >= 0 || shapeIndex >= 0)
            ? {
                x: colorIndex >= 0 ? 524 : 30,
                y: 145 + Math.max(colorIndex, shapeIndex) * 50,
                w: 476,
                h: 46,
              }
            : b.role === "choice"
              ? {
                  x: 30 + (choiceIndex % 2) * 494,
                  y: 145 + Math.floor(choiceIndex / 2) * 50,
                  w: 476,
                  h: 46,
                }
              : b.role === "primary"
                ? { x: 524, y: 300, w: 476, h: 58 }
                : b.role === "navigation"
                  ? {
                      x: b.value === "restart" ? 524 : 30,
                      y: b.value === "restart" ? 365 : 300,
                      w: 476,
                      h: b.value === "restart" ? 42 : 58,
                    }
                  : {
                      x:
                        b.value === "environment"
                          ? 500
                          : b.value === "close"
                            ? 750
                            : 30,
                      y: 365,
                      w:
                        b.value === "environment"
                          ? 240
                          : b.value === "close"
                            ? 250
                            : 460,
                      h: 42,
                    };
        return {
          ...b,
          highlight: (highlight ?? c.lastAction) === b.value,
          ...position,
        };
      })
      .filter((b) => !(c.step === 3 && b.value === "restart")),
  };
}
export function CreationPanel({
  state: c,
  run,
  patch,
  canFly,
  canShare,
  message,
  highlight,
}: {
  state: CreationState;
  run: (v: string) => void;
  patch: (recipe: WorkshopRecipe) => void;
  canFly: boolean;
  canShare: boolean;
  message: string;
  highlight?: string;
}) {
  const [name, setName] = useState(c.entry.name);
  useEffect(() => setName(c.entry.name), [c.entry.name]);
  const sound = c.entry.recipe.aircraft.sound ?? DEFAULT_SOUND;
  return (
    <section
      className="creation-shelf creation-workspace"
      data-ai-control="creation"
      aria-label="一機をつくる"
    >
      <h2>あなたの一機をつくろう</h2>
      <p>
        {c.step + 1} / 4　{CREATION_STEPS[c.step]} ・{" "}
        {c.dirty ? "未保存" : "保存済み"}
      </p>
      <strong>{c.entry.name}</strong>
      <p>
        全長 {c.entry.recipe.aircraft.bodyLengthM}m ／ 翼幅{" "}
        {c.entry.recipe.aircraft.wingSpanM}m
      </p>
      {c.step === 2 && (
        <label>
          機体の名前
          <input
            aria-label="制作中の機体の名前"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim()) run(`name:${name}`);
              else setName(c.entry.name);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </label>
      )}
      <div className="creation-choices">
        {creationButtons(c, run, canFly, canShare).map((b) => (
          <button
            key={b.value}
            disabled={!b.enabled}
            data-creation-role={b.role}
            data-creation-action={b.value}
            data-ai-highlight={
              (highlight ?? c.lastAction) === b.value || undefined
            }
            onClick={b.press}
          >
            {b.label}
          </button>
        ))}
      </div>
      <details>
        <summary>数値で細かく調整する</summary>
        {(
          [
            ["bodyLengthM", "全長", 50, 85],
            ["wingSpanM", "翼幅", 45, 85],
          ] as const
        ).map(([key, label, min, max]) => (
          <label key={key}>
            {label} {c.entry.recipe.aircraft[key]} m
            <input
              aria-label={`制作中の${label}`}
              type="range"
              min={min}
              max={max}
              value={c.entry.recipe.aircraft[key]}
              onChange={(ev) =>
                patch({
                  ...c.entry.recipe,
                  aircraft: {
                    ...c.entry.recipe.aircraft,
                    [key]: Number(ev.target.value),
                  },
                })
              }
            />
          </label>
        ))}
        {(
          [
            ["body", "低く厚い響き"],
            ["fan", "ファンの響き"],
            ["air", "風の響き"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label} {Math.round(sound[key] * 100)}%
            <input
              aria-label={`制作中の${label}`}
              type="range"
              min={0}
              max={100}
              value={Math.round(sound[key] * 100)}
              onChange={(ev) =>
                patch({
                  ...c.entry.recipe,
                  aircraft: {
                    ...c.entry.recipe.aircraft,
                    sound: { ...sound, [key]: Number(ev.target.value) / 100 },
                  },
                })
              }
            />
          </label>
        ))}
      </details>
      <p role="status">
        {message ||
          "保存はこのブラウザに残ります。飛ばした機体は、この部屋にも登録されます。"}
      </p>
    </section>
  );
}
