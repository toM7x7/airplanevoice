import { expect, it } from "vitest";
import {
  editNameKeys,
  nameKeyboardPanel,
  type NameKeys,
} from "../apps/desktop/src/ui/name-keyboard";
import { newCreation, changeCreation } from "../packages/core/src/creation";
import { parseWorkshop, DEFAULT_WORKSHOP } from "../packages/core/src/workshop";
it("types kana, modifiers, katakana and ASCII without committing until confirmation", () => {
  let s: NameKeys = { text: "", mode: "かな" };
  for (const k of ["は", "濁点", "濁点", "や", "小字"]) s = editNameKeys(s, k);
  expect(s.text).toBe("ぱゃ");
  s = editNameKeys(s, "消す");
  expect(s.text).toBe("ぱ");
  s = editNameKeys(s, "全消");
  s = editNameKeys(s, "カナ");
  s = editNameKeys(s, "ハ");
  s = editNameKeys(s, "濁点");
  expect(s.text).toBe("バ");
  s = editNameKeys(s, "ABC");
  s = editNameKeys(s, "7");
  expect(s.text).toBe("バ7");
  expect(editNameKeys({ ...s, text: "あ".repeat(40) }, "い").text.length).toBe(
    40,
  );
  expect(
    nameKeyboardPanel({ ...s, text: " " }, () => {}).buttons.find(
      (b) => b.label === "確定",
    )?.enabled,
  ).toBe(false);
});
it("keeps all keyboard hit areas separate and away from the dock", () => {
  for (const mode of ["かな", "カナ", "ABC"] as const) {
    const bs = nameKeyboardPanel({ text: "そら", mode }, () => {}).buttons;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      expect(a.y + a.h).toBeLessThanOrEqual(416);
      for (const b of bs.slice(i + 1))
        expect(
          a.x < b.x + b.w &&
            b.x < a.x + a.w &&
            a.y < b.y + b.h &&
            b.y < a.y + a.h,
        ).toBe(false);
    }
  }
});
it("preserves colour through shape edits and recipe serialization; rejects arbitrary values", () => {
  const c = changeCreation(
    changeCreation(newCreation(crypto.randomUUID()), "color:2"),
    "shape:1",
  );
  expect(c.entry.recipe.aircraft.color).toBe("#a54840");
  expect(parseWorkshop(JSON.stringify(c.entry.recipe)).aircraft.color).toBe(
    "#a54840",
  );
  expect(() =>
    parseWorkshop(
      JSON.stringify({
        ...DEFAULT_WORKSHOP,
        aircraft: { ...DEFAULT_WORKSHOP.aircraft, color: "url(bad)" },
      }),
    ),
  ).toThrow();
});


it("separates colour from shape and keeps VR/AR switching clear on every creation step", async () => {
  const {creationVrPanel} = await import("../apps/desktop/src/CreationPanel");
  for (let step = 0; step < 4; step++) {
    const c = {...newCreation("test-aircraft"), step};
    const panel = creationVrPanel(c, () => {}, true, "", undefined, true, true, true);
    expect(panel.buttons.some(b => b.label === "VRに戻る" && b.enabled)).toBe(true);
    for (const [i, a] of panel.buttons.entries()) {
      expect(a.y + a.h).toBeLessThanOrEqual(416);
      for (const b of panel.buttons.slice(i + 1)) {
        expect(a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y).toBe(false);
      }
    }
    if (step === 0) {
      expect(panel.buttons.filter(b => b.label.startsWith("尾翼：")).every(b => b.x === 524)).toBe(true);
    }
  }
});
