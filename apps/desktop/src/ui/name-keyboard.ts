import type { SharedVrPanel } from "../vr";
export type NameKeys = { text: string; mode: "かな" | "カナ" | "ABC" };
export function editNameKeys(state: NameKeys, key: string): NameKeys {
  if (key === "かな" || key === "カナ" || key === "ABC")
    return { ...state, mode: key };
  const chars = [...state.text];
  if (key === "全消") return { ...state, text: "" };
  if (key === "消す") chars.pop();
  else if (key === "小字" || key === "濁点") {
    const cycles =
      key === "小字"
        ? [
            "あぁ",
            "いぃ",
            "うぅ",
            "えぇ",
            "おぉ",
            "つっ",
            "やゃ",
            "ゆゅ",
            "よょ",
            "わゎ",
          ]
        : [
            "うゔ",
            "かが",
            "きぎ",
            "くぐ",
            "けげ",
            "こご",
            "さざ",
            "しじ",
            "すず",
            "せぜ",
            "そぞ",
            "ただ",
            "ちぢ",
            "つづ",
            "てで",
            "とど",
            "はばぱ",
            "ひびぴ",
            "ふぶぷ",
            "へべぺ",
            "ほぼぽ",
          ];
    const last = chars.at(-1);
    if (last)
      for (const raw of cycles) {
        const cycle =
          last >= "ァ" && last <= "ヶ"
            ? [...raw]
                .map((c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
                .join("")
            : raw;
        const index = cycle.indexOf(last);
        if (index >= 0) {
          chars[chars.length - 1] = cycle[(index + 1) % cycle.length];
          break;
        }
      }
  } else if (chars.length < 40) chars.push(key);
  return { ...state, text: chars.join("") };
}
export function nameKeyboardPanel(
  state: NameKeys,
  press: (key: string) => void,
): SharedVrPanel {
  const kana =
    "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんー";
  const keys =
    state.mode === "ABC"
      ? [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- "]
      : [...kana].map((c) =>
          state.mode === "カナ" && c !== "ー"
            ? String.fromCharCode(c.charCodeAt(0) + 0x60)
            : c,
        );
  return {
    layout: "authored",
    title: "機体の名前を入力",
    status: state.text || "（名前を入力してください）",
    detail: "かな・カナ・英数字／40文字まで。漢字はPCで入力できます。",
    buttons: [
      ...keys.map((key, i) => ({
        label: key === " " ? "空白" : key,
        x: 28 + (i % 10) * 97,
        y: 145 + Math.floor(i / 10) * 43,
        w: 90,
        h: 39,
        press: () => press(key),
      })),
      ...[
        "かな",
        "カナ",
        "ABC",
        "小字",
        "濁点",
        "消す",
        "全消",
        "取消",
        "確定",
      ].map((key, i) => ({
        label: key,
        x: 28 + i * 108,
        y: 369,
        w: 101,
        h: 42,
        role: key === "確定" ? "primary" : "navigation",
        enabled: key !== "確定" || !!state.text.trim(),
        press: () => press(key),
      })),
    ],
  };
}
