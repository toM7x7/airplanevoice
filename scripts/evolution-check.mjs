import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const out = "output/evolution";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
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
  await page.waitForTimeout(100);
};
const enabled = () =>
  page.getByRole("checkbox", {
    name: "周回ごとに変化して飛び続ける",
    exact: true,
  });
const reset = () =>
  page.getByRole("button", { name: "リセット", exact: true }).click();
const info = () =>
  page.getByRole("button", { name: "機体情報を表示", exact: true }).click();
async function finish() {
  let s = await state();
  await step(Math.max(0, s.durationMs - s.elapsedMs));
  for (let i = 0; i < 80 && (await state()).phase !== "INTERLAP"; i++)
    await step(250);
  assert.equal((await state()).phase, "INTERLAP");
}
try {
  await page.goto("http://127.0.0.1:5173/");
  await page.waitForFunction(() => typeof window.advanceTime === "function");
  await step(0);
  const initial = await state();
  assert.equal(initial.evolution.enabled, false);
  await enabled().check();
  await page
    .getByRole("slider", { name: "周回の変化の幅", exact: true })
    .fill("0.8");
  assert.equal((await state()).evolution.amount, 0.8);
  await page.screenshot({ path: `${out}/01-setup.png` });
  await page.getByRole("button", { name: "3機", exact: true }).click();
  await page.getByLabel("飛び始める間隔", { exact: true }).selectOption("16");
  await page.locator("#start-btn").click();
  await step(22000);
  await info();
  await page
    .getByRole("button", { name: "ST-02の情報を見る", exact: true })
    .click();
  const before = await state();
  const saved = await page.evaluate(() => ({ ...localStorage }));
  await step(before.durationMs - 32000 - before.elapsedMs);
  assert.equal((await state()).lap, 0);
  assert.equal((await state()).checksum, initial.checksum);
  assert.equal((await state()).fleet[2].state, "flying");
  await finish();
  let s = await state();
  assert.equal(s.pendingCount, 0);
  assert(s.evolution.nextInSec > 5.5);
  await page.getByRole("button", { name: "ひと休み", exact: true }).click();
  const rest = await state();
  await step(9000);
  assert.equal((await state()).nowMs, rest.nowMs);
  assert.equal((await state()).lap, 0);
  await page.screenshot({ path: `${out}/02-rest-paused.png` });
  await page
    .getByRole("button", { name: "飛行を再開する", exact: true })
    .click();
  await step(rest.evolution.nextInSec * 1000);
  s = await state();
  assert.equal(s.lap, 1);
  assert.equal(s.phase, "COMPILE");
  assert.notEqual(s.checksum, initial.checksum);
  assert.equal(s.inspection.id, "ST-02");
  assert.equal(s.inspection.state, "waiting");
  assert.equal(s.focusId, "ST-01");
  assert.deepEqual(await page.evaluate(() => ({ ...localStorage })), saved);
  await step(21500);
  await page
    .getByRole("button", { name: "この機体の方を向く ↗", exact: true })
    .click();
  await step(0);
  assert.equal((await state()).inspection.state, "flying");
  assert.equal(
    await page.getByRole("img", { name: "現在の主航路を上から見た図" }).count(),
    1,
  );
  await page.screenshot({ path: `${out}/03-second-lap.png` });
  const textures = (await state()).render.textures;
  const geometries = (await state()).render.geometries;
  for (let i = 0; i < 4; i++) {
    await finish();
    await step(9000);
  }
  s = await state();
  assert.equal(s.lap, 5);
  assert(s.render.geometries <= geometries + 2);
  assert(s.render.textures <= textures + 1);
  const chosen = s.checksum;
  await page
    .getByRole("button", { name: "この航路を残して編集", exact: true })
    .click();
  assert.equal((await state()).phase, "EDIT");
  assert.equal((await state()).checksum, chosen);
  await page.reload();
  await page.waitForFunction(() => typeof window.advanceTime === "function");
  await step(0);
  assert.equal((await state()).checksum, chosen);
  assert.equal((await state()).evolution.enabled, false);
  await reset();
  await enabled().check();
  await page.locator("#start-btn").click();
  await step(3000);
  await finish();
  await enabled().uncheck();
  await step(12000);
  assert.equal((await state()).lap, 0);
  assert.equal((await state()).phase, "INTERLAP");
  await enabled().check();
  await step(6000);
  assert.equal((await state()).lap, 1);
  await page
    .getByRole("button", { name: "航路を描き直す", exact: false })
    .click();
  assert.equal((await state()).checksum, initial.checksum);
  assert.equal((await state()).evolution.nextInSec, null);
  // Backgrounding must also stop an automatic restart during the rest period.
  await page.locator("#start-btn").click();
  await step(3000);
  await finish();
  const other = await context.newPage();
  await other.goto("about:blank");
  await other.bringToFront();
  await page.waitForTimeout(150);
  // Headless Chromium does not consistently mark other tabs hidden. Exercise the
  // browser visibility handler without changing simulation or UI state directly.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal((await state()).paused, true);
  await page.evaluate(() => {
    delete document.hidden;
  });
  await other.close();
  await page.bringToFront();
  await step(10000);
  assert.equal((await state()).lap, 0);
  await reset();
  await page.setViewportSize({ width: 390, height: 844 });
  await enabled().check();
  await page.locator("#start-btn").click();
  await step(3000);
  await finish();
  await step(9000);
  await page.screenshot({ path: `${out}/04-mobile.png`, fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await reset();
  await page.setViewportSize({ width: 1366, height: 768 });
  await enabled().focus();
  await page.keyboard.press("Space");
  assert.equal((await state()).evolution.enabled, true);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/result.json`,
    JSON.stringify({ passed: true, scenarios: 12, errors }, null, 2),
  );
  console.log("Evolution checks passed (12 scenarios).");
} finally {
  await fs.writeFile(
    `${out}/last-state.json`,
    JSON.stringify(await state().catch(() => ({})), null, 2),
  );
  await page.screenshot({ path: `${out}/last-screen.png`, fullPage: true });
  await browser.close();
}
