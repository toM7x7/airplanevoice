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
  const originalChecksum = state.checksum;
  await page
    .getByRole("checkbox", {
      name: "周回ごとに変化して飛び続ける",
      exact: true,
    })
    .check();
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
  await page
    .getByRole("button", { name: "機体情報を表示", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この機体の方を向く", exact: false })
    .click();
  await page
    .getByRole("button", { name: "機体情報を閉じる", exact: true })
    .click();
  await page.waitForFunction(() =>
    JSON.parse(window.render_game_to_text()).aircraftTargets.some(
      (t) => t.id === "ST-01",
    ),
  );
  const target = await page.evaluate(() =>
    JSON.parse(window.render_game_to_text()).aircraftTargets.find(
      (t) => t.id === "ST-01",
    ),
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
  assert.equal(
    await page.locator(".version").textContent(),
    "WORKSHOP · v0.4.0",
  );
  await fs.mkdir("output/workshop", { recursive: true });
  await page.screenshot({ path: "output/workshop/06-offline.png" });
  console.log(
    "First offline flight and aircraft inspection passed; waiting for the next lap in real time.",
  );
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).lap === 1,
    {},
    { timeout: 180000 },
  );
  const next = await page.evaluate(() =>
    JSON.parse(window.render_game_to_text()),
  );
  assert.notEqual(next.checksum, originalChecksum);
  assert.equal(next.evolution.enabled, true);
  await page.waitForFunction(
    (played) => {
      const s = JSON.parse(window.render_game_to_text());
      return s.lap === 1 && s.arrivedCount > 0 && s.audio.played > played;
    },
    next.audio.played,
    { timeout: 30000 },
  );
  state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  assert.equal(state.inspection.id, "ST-01");
  assert.equal(state.inspection.state, "flying");
  assert.equal(state.offline.online, false);
  await page
    .getByRole("button", { name: "この機体の方を向く", exact: false })
    .click();
  await page
    .getByRole("img", { name: "現在の主航路を上から見た図" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "output/workshop/07-offline-evolution.png" });
  await page
    .getByRole("checkbox", {
      name: "周回ごとに変化して飛び続ける",
      exact: true,
    })
    .uncheck();
  assert.equal(
    (await page.evaluate(() => JSON.parse(window.render_game_to_text())))
      .evolution.enabled,
    false,
  );
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
    JSON.stringify({
      offline: "passed",
      url,
      lap: state.lap + 1,
      played: state.audio.played,
    }),
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
