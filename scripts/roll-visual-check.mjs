import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const out = "output/roll/visual";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto("http://127.0.0.1:5173/");
  await page.waitForFunction(() => window.advanceTime);
  const step = async (ms) => {
    await page.evaluate((ms) => window.advanceTime(ms), ms);
    await page.waitForTimeout(120);
  };
  const state = () =>
    page.evaluate(() => JSON.parse(window.render_game_to_text()));
  await step(0);
  await page.locator("#start-btn").click();
  await step(25000);
  await page
    .getByRole("button", { name: "機体情報を表示", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この機体の方を向く ↗", exact: true })
    .click();
  await page
    .getByRole("button", { name: "機体情報を閉じる", exact: true })
    .click();
  await page.getByRole("button", { name: "遠くを見る", exact: true }).click();
  const samples = [];
  for (let i = 0; i < 7; i++) {
    await step(i ? 250 : 0);
    const s = await state();
    assert.equal(s.phase, "FLY");
    assert(s.aircraftTargets.some((t) => t.id === "ST-01"));
    samples.push({ elapsedMs: s.elapsedMs, pose: s.aircraft });
    await page.screenshot({ path: `${out}/frame-${i}.png` });
  }
  const rates = samples
    .slice(1)
    .map(
      (s, i) =>
        (Math.abs(s.pose.bankRad - samples[i].pose.bankRad) * 180) /
        Math.PI /
        ((s.elapsedMs - samples[i].elapsedMs) / 1000),
    );
  assert(Math.max(...rates) < 2);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/report.json`,
    JSON.stringify({ samples, rates, errors }, null, 2),
  );
  console.log(
    "OK Close flyby: 7 fixed-camera frames, stable roll, no browser errors",
  );
} finally {
  await browser.close();
}
