import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const url = process.env.SOUND_TRAIL_URL ?? "http://127.0.0.1:4173/";
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
const network = [];
page.on("requestfailed", (r) =>
  network.push({ url: r.url(), error: r.failure()?.errorText }),
);
page.on("console", (m) => {
  if (m.type() === "error") network.push({ console: m.text() });
});
try {
  await page.goto(url);
  await page.waitForFunction(
    () => typeof window.render_game_to_text === "function",
  );
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).offline.ready,
    {},
    { timeout: 30000 },
  );
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.equal(
    await page.evaluate(() => typeof window.advanceTime),
    "undefined",
  );
  await page
    .getByRole("button", { name: "つくる実験室 →", exact: true })
    .click();
  await page.getByRole("slider", { name: "翼の幅", exact: true }).fill("77");
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(
    () => typeof window.render_game_to_text === "function",
  );
  let state = await page.evaluate(() =>
    JSON.parse(window.render_game_to_text()),
  );
  assert.equal(state.aircraftDesign.wingSpanM, 77);
  assert.equal(state.offline.online, false);
  await page.locator("#start-btn").click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).arrivedCount > 0,
    {},
    { timeout: 20000 },
  );
  state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  assert.equal(state.phase, "FLY");
  assert.equal(state.audio.state, "running");
  assert(state.audio.played > 0);
  await page.getByRole("button", { name: "機体情報を表示", exact: true }).click();
  await page.getByRole("button", { name: "この機体の方を向く", exact: false }).click();
  await page.getByRole("button", { name: "機体情報を閉じる", exact: true }).click();
  await page.waitForFunction(() =>
    JSON.parse(window.render_game_to_text()).aircraftTargets.some((t) => t.id === "ST-01"),
  );
  const target = await page.evaluate(() =>
    JSON.parse(window.render_game_to_text()).aircraftTargets.find((t) => t.id === "ST-01"),
  );
  const sky = await page.locator(".world").boundingBox();
  await page.mouse.click(sky.x + target.x, sky.y + target.y);
  await page.getByRole("region", { name: "選んだ機体の情報" }).waitFor();
  state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  assert.equal(state.inspection.id, "ST-01");
  assert.equal(state.inspection.state, "flying");
  assert.equal(state.inspection.speedMps, 58);
  assert(Number.isFinite(state.inspection.headingDeg));
  assert(state.inspection.distanceM > 0);
  assert.equal(state.offline.online, false);
  assert.equal(await page.locator(".version").textContent(), "WORKSHOP · v0.3.1");
  await fs.mkdir("output/workshop", { recursive: true });
  await page.screenshot({ path: "output/workshop/06-offline.png" });
  await context.setOffline(false);
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).offline.online,
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "output/workshop/offline-result.json",
    JSON.stringify({ passed: true, url, errors, state }, null, 2),
  );
  console.log(
    JSON.stringify({ offline: "passed", url, played: state.audio.played }),
  );
} finally {
  await fs.mkdir("output/workshop", { recursive: true });
  await fs.writeFile(
    "output/workshop/offline-debug.json",
    JSON.stringify(
      {
        network,
        errors,
        url: page.url(),
        html: (await page.content()).slice(0, 3000),
        caches: await page
          .evaluate(async () =>
            Promise.all(
              (await caches.keys()).map(async (name) => ({
                name,
                keys: (await (await caches.open(name)).keys()).map(
                  (r) => r.url,
                ),
              })),
            ),
          )
          .catch(() => []),
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: "output/workshop/offline-debug.png" });
  await browser.close();
}
