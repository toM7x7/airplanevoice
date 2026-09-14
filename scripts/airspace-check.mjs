import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const out = "output/airspace";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
const state = () =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
const step = async (ms) => {
  await page.evaluate((ms) => window.advanceTime(ms), ms);
  await page.waitForTimeout(100);
};
try {
  await page.goto(process.env.SOUND_TRAIL_URL ?? "http://127.0.0.1:5173");
  await page.waitForFunction(
    () => typeof window.render_game_to_text === "function",
  );
  await step(0);
  await page.getByRole("button", { name: "3機", exact: true }).click();
  await page.getByLabel("飛び始める間隔", { exact: true }).selectOption("8");
  await page.getByLabel("管制案内を表示する").check();
  await page.screenshot({ path: `${out}/01-setup.png` });
  await page.locator("#start-btn").click();
  let s = await state();
  assert.equal(s.fleet.length, 3);
  assert.equal(s.towerCue.fact.type, "scheduled");
  await page.screenshot({ path: `${out}/02-scheduled.png` });
  await step(2700);
  s = await state();
  assert.deepEqual(
    s.fleet.map((f) => f.state),
    ["flying", "waiting", "waiting"],
  );
  assert.equal(
    await page.getByRole("button", { name: "2機", exact: true }).isDisabled(),
    true,
  );
  await step(20000);
  await page.screenshot({ path: `${out}/03-three-aircraft.png` });
  // The farthest, last-starting aircraft needs its own propagation delay.
  await step(16000);
  s = await state();
  assert(s.fleet.every((f) => f.state === "flying" && f.arrivedCount > 0));
  // Exercise real-time audio: virtual time cannot establish whether every bus
  // gets a fair share of voices while sources are playing on the audio clock.
  for (let i = 0; i < 12; i++) {
    await step(100);
  }
  s = await state();
  assert(Object.values(s.audio.playedByFlight).length === 3);
  assert(Object.values(s.audio.playedByFlight).every((n) => n > 0));
  assert(s.audio.activeVoices <= 18);
  const before = s.fleet;
  await page.getByRole("button", { name: "ST-03に注目" }).click();
  s = await state();
  assert.equal(s.focusId, "ST-03");
  assert.deepEqual(s.fleet, before);
  await page.setViewportSize({ width: 1366, height: 768 });
  assert(
    await page
      .getByRole("button", { name: "ひと休み", exact: true })
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return [r.top + 2, r.bottom - 2].every(
          (y) =>
            document
              .elementFromPoint(r.x + r.width / 2, y)
              ?.closest("button") === el,
        );
      }),
  );
  await page.setViewportSize({ width: 1440, height: 1040 });
  // Keep sources active: Chromium may stop evaluating an unused bus's AudioParam.
  for (let i = 0; i < 15; i++) await step(100);
  s = await state();
  assert(s.audio.busLevels["ST-03"] > s.audio.busLevels["ST-01"] * 3);
  await page.getByRole("button", { name: "空全体を聴く", exact: true }).click();
  for (let i = 0; i < 15; i++) await step(100);
  s = await state();
  assert.equal(s.mixMode, "balanced");
  assert(
    Math.abs(s.audio.busLevels["ST-03"] - s.audio.busLevels["ST-01"]) < 0.02,
  );
  await page.getByRole("button", { name: "ひと休み", exact: true }).click();
  const paused = await state();
  await step(10000);
  assert.equal((await state()).nowMs, paused.nowMs);
  assert.equal((await state()).audio.activeVoices, 0);
  await page.getByRole("button", { name: "飛行を再開", exact: true }).click();
  await step(1000);
  await page.getByLabel("管制案内を表示する").uncheck();
  assert.equal((await state()).towerCue, null);
  await step(s.durationMs + 40000);
  s = await state();
  assert.equal(s.phase, "INTERLAP");
  assert(s.fleet.every((f) => f.state === "complete" && f.pendingCount === 0));
  await page.getByRole("button", { name: "もう一周、眺める" }).click();
  s = await state();
  assert.equal(s.fleet.length, 3);
  assert.equal(s.lap, 1);
  await page.getByRole("button", { name: /航路を描き直す/ }).click();
  await page.getByRole("button", { name: "リセット", exact: true }).click();
  s = await state();
  assert.equal(s.airspace.aircraftCount, 1);
  assert.equal(s.towerEnabled, false);
  assert.equal(s.focusId, "ST-01");
  // Narrow layout and simultaneous dispatch, with all controls still reachable.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "3機", exact: true }).click();
  await page.getByLabel("飛び始める間隔", { exact: true }).selectOption("0");
  await page.getByLabel("管制案内を表示する").check();
  await page.locator("#start-btn").click();
  await step(3000);
  assert((await state()).fleet.every((f) => f.state === "flying"));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `${out}/04-mobile-caption.png`,
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await step(24000);
  await page.getByRole("button", { name: "ST-02に注目" }).click();
  assert.equal((await state()).focusId, "ST-02");
  await page.screenshot({ path: `${out}/05-mobile-fleet.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/state.json`,
    JSON.stringify(await state(), null, 2),
  );
  await fs.writeFile(
    `${out}/result.json`,
    JSON.stringify({ passed: true, scenarios: 12, errors }, null, 2),
  );
  console.log("Airspace browser checks passed: 12 scenarios");
} finally {
  await fs.writeFile(
    `${out}/last-state.json`,
    JSON.stringify(await state(), null, 2),
  );
  await browser.close();
}
