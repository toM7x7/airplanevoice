import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const out = "output/observation";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const state = () =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
const step = async (ms) => {
  await page.evaluate((ms) => window.advanceTime(ms), ms);
  await page.waitForTimeout(120);
};
const toggle = () =>
  page.getByRole("button", { name: "機体情報を表示", exact: true }).click();
const close = () =>
  page.getByRole("button", { name: "機体情報を閉じる", exact: true }).click();
const select = (id) =>
  page.getByRole("button", { name: `${id}の情報を見る`, exact: true }).click();
const panel = page.getByRole("region", {
  name: "選んだ機体の情報",
  exact: true,
});
async function point(id) {
  const t = (await state()).aircraftTargets.find((t) => t.id === id);
  assert(t, `${id} should be on screen`);
  const rect = await page.locator("canvas").boundingBox();
  return { x: rect.x + t.x, y: rect.y + t.y };
}
async function look() {
  await page
    .getByRole("button", { name: "この機体の方を向く ↗", exact: true })
    .click();
  await step(0);
}
try {
  await page.goto("http://127.0.0.1:5173/");
  await page.waitForFunction(() => typeof window.advanceTime === "function");
  await step(0);
  assert.equal((await state()).inspection, null);
  await toggle();
  await look();
  await close();
  const initial = await state();
  const first = await point("ST-01");
  await page.mouse.click(first.x, first.y);
  let s = await state();
  assert.equal(s.inspection.id, "ST-01");
  assert.equal(s.inspection.state, "preview");
  assert.equal(s.inspection.speedMps, 58);
  assert.equal(s.checksum, initial.checksum);
  assert.deepEqual(s.mixGains, initial.mixGains);
  assert((await panel.innerText()).includes("設定速度"));
  await close();
  // A look-around drag that returns to the starting point must not be a click.
  const p = await point("ST-01");
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 70, p.y + 20, { steps: 6 });
  await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.mouse.up();
  assert.equal((await state()).inspection, null);
  await page.getByRole("button", { name: "3機", exact: true }).click();
  await page.getByLabel("飛び始める間隔", { exact: true }).selectOption("16");
  await page.locator("#start-btn").click();
  await step(4000);
  await toggle();
  await select("ST-03");
  s = await state();
  assert.equal(s.inspection.state, "waiting");
  assert.equal(s.inspection.headingDeg, null);
  assert((await panel.innerText()).includes("飛行が始まると"));
  await select("ST-02");
  await step(17000);
  await look();
  await close();
  const second = await point("ST-02");
  await page.mouse.click(second.x, second.y);
  s = await state();
  assert.equal(s.inspection.id, "ST-02");
  assert.equal(s.inspection.state, "flying");
  assert.equal(s.focusId, "ST-01");
  assert.equal(s.mixMode, "focus");
  const pose = s.fleet.find((f) => f.id === "ST-02").pose;
  const expected =
    ((Math.atan2(pose.tangent.x, -pose.tangent.z) * 180) / Math.PI + 360) % 360;
  assert(Math.abs(s.inspection.headingDeg - expected) < 0.001);
  assert.equal(s.inspection.altitudeM, pose.position.y);
  const previous = s.inspection.headingDeg;
  await step(3000);
  assert.notEqual((await state()).inspection.headingDeg, previous);
  // Camera direction is unrelated to the aircraft's compass direction.
  const heading = (await state()).inspection.headingDeg;
  const rect = await page.locator("canvas").boundingBox();
  await page.mouse.move(rect.x + 70, rect.y + 110);
  await page.mouse.down();
  await page.mouse.move(rect.x + 190, rect.y + 135, { steps: 8 });
  await page.mouse.up();
  assert.equal((await state()).inspection.headingDeg, heading);
  await look();
  await page.screenshot({ path: `${out}/01-flight-info.png` });
  await page.getByRole("button", { name: "ひと休み", exact: true }).click();
  const frozen = (await state()).inspection;
  await step(2000);
  assert.deepEqual((await state()).inspection, frozen);
  assert.equal(frozen.paused, true);
  await page
    .getByRole("button", { name: "飛行を再開する", exact: true })
    .click();
  await step(18000);
  await select("ST-03");
  await look();
  await page.screenshot({ path: `${out}/02-third-aircraft.png` });
  await close();
  await page.setViewportSize({ width: 1000, height: 800 });
  await step(0);
  const resized = await point("ST-03");
  await page.mouse.click(resized.x, resized.y);
  assert.equal((await state()).inspection.id, "ST-03");
  // Escape closes only the information first, including when a button is focused.
  await page.keyboard.press("Escape");
  assert.equal((await state()).inspection, null);
  assert.equal((await state()).phase, "FLY");
  await toggle();
  await select("ST-01");
  s = await state();
  await step(s.durationMs - s.elapsedMs + 20000);
  s = await state();
  assert.equal(s.inspection.visible, false);
  assert.equal(s.inspection.speedMps, null);
  assert((await panel.innerText()).includes("飛行は終わりました"));
  assert.equal(await page.locator(".aircraft-marker").isVisible(), false);
  await page.getByRole("button", { name: "リセット", exact: true }).click();
  assert.equal((await state()).inspection, null);
  await page.getByRole("button", { name: "3機", exact: true }).click();
  await toggle();
  await select("ST-03");
  await page.getByRole("button", { name: "1機", exact: true }).click();
  assert.equal((await state()).inspection, null);
  // Real touch input after a mobile layout change, rather than DOM event injection.
  await page.setViewportSize({ width: 390, height: 844 });
  await step(0);
  await toggle();
  await look();
  await close();
  const mobile = await point("ST-01");
  await page.touchscreen.tap(mobile.x, mobile.y);
  assert.equal((await state()).inspection.id, "ST-01");
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const box = await panel.boundingBox();
  assert(box.x >= 0 && box.x + box.width <= 390);
  await page.screenshot({ path: `${out}/03-mobile.png`, fullPage: true });
  await page.getByRole("button", { name: "3機", exact: true }).click();
  const beforeClear = await state();
  await page
    .getByRole("button", { name: "選択を外して空全体を聴く", exact: true })
    .click();
  s = await state();
  assert.equal(s.inspection, null);
  assert.equal(s.mixMode, "balanced");
  for (const id of ["ST-01", "ST-02", "ST-03"]) {
    assert.equal(
      await page
        .getByRole("button", { name: `${id}に注目`, exact: true })
        .getAttribute("aria-pressed"),
      "false",
    );
  }
  assert.equal(s.checksum, beforeClear.checksum);
  assert.equal(s.elapsedMs, beforeClear.elapsedMs);
  assert.equal(await page.locator(".aircraft-marker").isVisible(), false);
  // Keyboard access through the visible information button.
  await page
    .getByRole("button", { name: "機体情報を表示", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  assert.equal((await state()).inspection.id, "ST-01");
  await page.setViewportSize({ width: 1366, height: 768 });
  await step(0);
  const skyRect = await page.locator("canvas").boundingBox();
  const empty = {
    x: skyRect.x + skyRect.width * 0.5,
    y: skyRect.y + skyRect.height * 0.15,
  };
  assert(
    await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y) instanceof HTMLCanvasElement,
      empty,
    ),
  );
  // Dragging and cancelling a pointer are not empty-space clicks.
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  await page.mouse.move(empty.x - 80, empty.y + 20, { steps: 4 });
  await page.mouse.up();
  assert.equal((await state()).inspection.id, "ST-01");
  await page.locator("canvas").evaluate((canvas) =>
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        window.testPointerId = event.pointerId;
      },
      { once: true },
    ),
  );
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  const pointerId = await page.evaluate(() => window.testPointerId);
  await page.locator("canvas").dispatchEvent("pointercancel", { pointerId });
  await page.mouse.up();
  assert.equal((await state()).inspection.id, "ST-01");
  await page.mouse.click(empty.x, empty.y);
  assert.equal((await state()).inspection, null);
  assert.equal((await state()).mixMode, "balanced");
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/result.json`,
    JSON.stringify({ passed: true, scenarios: 15, errors }, null, 2),
  );
  console.log("Observation browser checks passed: 15 scenarios");
} finally {
  await page.screenshot({ path: `${out}/last-screen.png`, fullPage: true });
  await fs.writeFile(
    `${out}/last-state.json`,
    JSON.stringify(await state(), null, 2),
  );
  await browser.close();
}
