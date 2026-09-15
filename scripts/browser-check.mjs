import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const base = process.env.SOUND_TRAIL_URL ?? "http://127.0.0.1:5173";
const out = "output/browser";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const errors = [];
const page = await browser.newPage({
  viewport: { width: 1440, height: 1040 },
  deviceScaleFactor: 1,
});
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
const state = () =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
const step = async (ms) => {
  await page.evaluate((ms) => window.advanceTime(ms), ms);
  await page.waitForTimeout(100);
};
try {
  await page.goto(base);
  await page.waitForFunction(
    () => typeof window.render_game_to_text === "function",
  );
  await step(0);
  await page.screenshot({ path: `${out}/01-editor.png`, fullPage: true });
  const initial = await state();
  assert.equal(initial.phase, "EDIT");
  assert.equal(initial.designLineVisible, true);
  // Preset change and full undo chain.
  await page.getByRole("button", { name: /ゆるい起伏/ }).click();
  assert.notEqual((await state()).checksum, initial.checksum);
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  assert.equal((await state()).checksum, initial.checksum);
  // Move an actual control point through the SVG's transformed viewport.
  const point = page.locator('[data-point="3"]');
  await point.scrollIntoViewIfNeeded();
  const handle = await point.boundingBox();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + 12,
    handle.y + handle.height / 2 - 8,
    { steps: 8 },
  );
  await page.mouse.up();
  assert.notEqual((await state()).checksum, initial.checksum);
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  assert.equal((await state()).checksum, initial.checksum);
  // Draw a closed orbit with real pointer input, then undo it.
  await page
    .getByRole("button", { name: "＋ 一筆で描く", exact: true })
    .click();
  const map = await page.getByTestId("route-map").boundingBox();
  const ellipse = (i) => {
    const a = (i / 45) * Math.PI * 2;
    return {
      x: map.x + map.width * (0.5 + 0.34 * Math.sin(a)),
      y: map.y + map.height * (0.45 + 0.34 * Math.cos(a)),
    };
  };
  const first = ellipse(0);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let i = 1; i <= 45; i++) {
    const p = ellipse(i);
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
  assert.equal((await state()).routeId, "drawn");
  assert((await state()).routePoints >= 20);
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  assert.equal((await state()).checksum, initial.checksum);
  // Start through a user gesture, run real audio for a few seconds later.
  await page.locator("#start-btn").click();
  assert.equal((await state()).phase, "COMPILE");
  await step(1000);
  assert.equal((await state()).arrivedCount, 0);
  await step(1750);
  assert.equal((await state()).phase, "FLY");
  assert.equal((await state()).designLineVisible, false);
  await step(22000);
  const flying = await state();
  assert(flying.arrivedCount > 0);
  assert(flying.visibleTrailCount > 0);
  assert(flying.audio.played > 0);
  assert(flying.audio.activeVoices <= 8);
  assert.equal(flying.phase, "FLY");
  await page.screenshot({
    path: `${out}/02-flight-and-arrival.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "ひと休み", exact: true }).click();
  const paused = await state();
  await step(9000);
  assert.equal((await state()).nowMs, paused.nowMs);
  await page.getByRole("button", { name: "飛行を再開", exact: true }).click();
  await step(1000);
  assert((await state()).nowMs > paused.nowMs);
  await page.getByRole("button", { name: "遠くを見る", exact: true }).click();
  assert.equal((await state()).view.zoom, true);
  await page.screenshot({ path: `${out}/03-binocular.png`, fullPage: true });
  await page
    .getByRole("button", { name: "音声を切り替え", exact: true })
    .click();
  assert.equal((await state()).audio.muted, true);
  // Finish, wait for the last emissions, then change observer and replay.
  await step(flying.durationMs + 30000);
  assert.equal((await state()).phase, "INTERLAP");
  await page.getByRole("button", { name: "丘の上", exact: true }).click();
  assert.equal((await state()).listener.y, 70);
  await page
    .getByRole("button", { name: "もう一周、眺める", exact: true })
    .click();
  assert.equal((await state()).lap, 1);
  assert.equal((await state()).recipe.id, "deep-return");
  await step(26000);
  await page
    .getByRole("button", { name: "航路を描き直す", exact: true })
    .click();
  assert.equal((await state()).phase, "EDIT");
  assert.equal((await state()).pendingCount, 0);
  // Settings, download, storage readback and explicit reset.
  await page.getByRole("button", { name: /音・表示の設定/ }).click();
  await page
    .getByRole("combobox", { name: "音の出力に合わせる" })
    .selectOption("headphones");
  assert.equal((await state()).audio.outputProfile, "headphones");
  await page
    .getByRole("combobox", { name: "音の出力に合わせる" })
    .selectOption("speaker");
  await page.getByRole("slider", { name: "音量", exact: true }).fill("40");
  assert.equal((await state()).audio.volume, 40);
  await page.getByRole("slider", { name: "音量", exact: true }).fill("35");
  await page.screenshot({
    path: "output/browser/08-audio-settings.png",
    fullPage: true,
  });
  await page.getByRole("slider", { name: "音の遅れの演出" }).fill("2");
  await page
    .getByRole("checkbox", { name: "到来波の表示を控えめにする" })
    .check();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /この体験のログを保存/ }).click();
  await (await download).saveAs(`${out}/session-log.json`);
  await page.getByRole("button", { name: /ゆるい起伏/ }).click();
  const saved = (await state()).checksum;
  await page.reload();
  await page.waitForFunction(
    () => typeof window.render_game_to_text === "function",
  );
  assert.equal((await state()).checksum, saved);
  await page.getByRole("button", { name: "リセット", exact: true }).click();
  assert.equal((await state()).checksum, initial.checksum);
  await page.getByRole("button", { name: "遊び方", exact: true }).click();
  assert(await page.getByRole("dialog").isVisible());
  await page.getByRole("button", { name: "空に戻る", exact: true }).click();
  await page.setViewportSize({ width: 1366, height: 768 });
  const startButton = await page.locator("#start-btn").boundingBox();
  assert(startButton.y + startButton.height <= 768);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  );
  await page.screenshot({ path: `${out}/06-laptop.png`, fullPage: true });
  // Narrow layout must remain usable and must not overflow horizontally.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/04-mobile.png`, fullPage: true });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert(await page.locator("#start-btn").isVisible());
  await page.locator("#start-btn").click();
  await step(26000);
  await page.screenshot({
    path: `${out}/05-mobile-flight.png`,
    fullPage: true,
  });
  await fs.writeFile(
    `${out}/final-state.json`,
    JSON.stringify(await state(), null, 2),
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        passed: true,
        errors,
        scenarios: [
          "presets",
          "undo",
          "freehand drawing",
          "countdown",
          "flight",
          "sound arrivals",
          "trail",
          "pause/resume",
          "zoom",
          "mute",
          "replay",
          "observer change",
          "settings",
          "log export",
          "storage reload",
          "reset",
          "help",
          "mobile layout",
          "control-point drag",
          "laptop launch visibility",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "Browser checks passed (20 scenarios). Screenshots: output/browser",
  );
} finally {
  await browser.close();
}
