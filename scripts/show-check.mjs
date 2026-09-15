import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const url = process.env.TEST_URL || "http://127.0.0.1:5173/";
const out = process.env.SHOW_OUTPUT || "output/show";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const checks = [],
  errors = [];
const record = (name) => {
  checks.push(name);
  console.log(`OK ${name}`);
};
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const watch = (page) => {
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
  };
  watch(page);
  const button = (name) => page.getByRole("button", { name, exact: true });
  const state = (p = page) =>
    p.evaluate(() => JSON.parse(window.render_game_to_text()));
  const ready = (p) =>
    p.waitForFunction(() => typeof window.render_game_to_text === "function");
  await page.goto(url);
  await ready(page);
  const development = await page.evaluate(
    () => typeof window.advanceTime === "function",
  );
  const step = async (ms) => {
    await page.evaluate((ms) => window.advanceTime(ms), ms);
    await page.waitForTimeout(120);
  };
  if (development) await step(0);
  await button("演目をつくる →").click();
  await button("三つの高さ").click();
  let s = await state();
  assert.equal(s.show.flights.length, 3);
  assert.equal(s.airspace.aircraftCount, 3);
  assert.deepEqual(
    s.show.flights.map((f) => f.recipe.aircraft.engineCount),
    [2, 4, 4],
  );
  assert.equal(await button("3機").count(), 0);
  record(
    "Show pattern creates three independent aircraft and locks legacy lane controls",
  );
  const first = structuredClone(s.show.flights[0]);
  await button("ST-02を編集").click();
  await page
    .getByRole("slider", { name: "ST-02の開始時刻", exact: true })
    .fill("29");
  await page.getByText("機体・航路を細かく調整", { exact: true }).click();
  await page
    .getByRole("slider", { name: "演目の高度", exact: true })
    .fill("360");
  await page
    .getByRole("slider", { name: "演目の速度", exact: true })
    .fill("55");
  s = await state();
  assert.deepEqual(s.show.flights[0], first);
  assert.equal(s.show.flights[1].startSec, 29);
  assert.equal(s.show.flights[1].recipe.route.altitudeM, 360);
  assert.equal(s.show.flights[1].recipe.flight.speedMps, 55);
  record(
    "Editing the second aircraft leaves the first design, route and timing unchanged",
  );
  await page.getByText("機体・航路を細かく調整", { exact: true }).click();
  await page.getByText("演目をJSONで保存・読み込み", { exact: true }).click();
  const expected = (await state()).show,
    checksum = (await state()).checksum;
  const bad = structuredClone(expected);
  bad.flights[1].recipe.route.b = { ...bad.flights[1].recipe.route.a };
  await page.getByLabel("演目JSON", { exact: true }).fill(JSON.stringify(bad));
  await button("演目JSONを適用").click();
  await page.getByRole("alert").waitFor();
  assert.equal((await state()).checksum, checksum);
  await page
    .getByLabel("演目JSON", { exact: true })
    .fill(JSON.stringify(expected));
  await button("演目JSONを適用").click();
  record(
    "Invalid JSON flight geometry preserves the entire last valid show; corrected JSON recovers",
  );
  const download = page.waitForEvent("download");
  await button("演目を書き出す ↓").click();
  const downloaded = await download;
  await downloaded.saveAs(`${out}/show.json`);
  assert.deepEqual(
    JSON.parse(await fs.readFile(`${out}/show.json`, "utf8")),
    expected,
  );
  record("Downloaded show JSON contains all routes, designs and start offsets");
  await page.reload();
  await ready(page);
  if (development) await step(0);
  assert.deepEqual((await state()).show, expected);
  assert.equal((await state()).phase, "EDIT");
  await page.screenshot({ path: `${out}/01-composer.png` });
  await page
    .getByRole("region", { name: "フライバイ観測所", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/02-prediction.png` });
  record(
    "Reload restores the show without launching and displays its pass predictions",
  );
  await button("この空をQuestへ渡す").click();
  await page.getByLabel("渡すURL", { exact: true }).waitFor();
  const link = await page.getByLabel("渡すURL", { exact: true }).inputValue();
  assert(link.includes("#sky=2."));
  const qr = page.getByAltText("この空の設定を開くQRコード", { exact: true });
  await qr.waitFor();
  await page.addScriptTag({
    content: await fs.readFile("node_modules/jsqr/dist/jsQR.js", "utf8"),
  });
  const decoded = await qr.evaluate(async (img) => {
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return jsQR(
      ctx.getImageData(0, 0, c.width, c.height).data,
      c.width,
      c.height,
    )?.data;
  });
  assert.equal(decoded, link);
  const recipient = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const receiver = await recipient.newPage();
  watch(receiver);
  await receiver.goto(development ? url + new URL(link).hash : link);
  await ready(receiver);
  await receiver
    .getByRole("button", { name: "この空を取り込む", exact: true })
    .waitFor();
  await receiver.screenshot({ path: `${out}/03-receive.png` });
  await receiver
    .getByRole("button", { name: "この空を取り込む", exact: true })
    .click();
  assert.deepEqual((await state(receiver)).show, expected);
  assert.equal((await state(receiver)).checksum, checksum);
  assert.equal((await state(receiver)).phase, "EDIT");
  await recipient.close();
  await button("空の受け渡しを閉じる").click();
  record(
    "QR independently decodes and imports all three aircraft on a separate narrow-screen receiver",
  );
  await page.locator("#start-btn").click();
  if (development) {
    await step(3500);
    s = await state();
    assert.equal(s.fleet[0].state, "flying");
    assert.equal(s.fleet[1].state, "waiting");
    await step(45000);
  } else
    await page.waitForFunction(
      () => {
        const s = JSON.parse(window.render_game_to_text());
        return s.fleet.every((f) => f.state === "flying");
      },
      undefined,
      { timeout: 60000 },
    );
  s = await state();
  assert(s.fleet.every((f) => f.state === "flying"));
  assert(new Set(s.fleet.map((f) => Math.round(f.pose.position.y))).size === 3);
  await button("届いた音を見る").click();
  await page
    .getByRole("region", { name: "フライバイ観測所", exact: true })
    .scrollIntoViewIfNeeded();
  assert((await state()).visibleTrailCount > 0);
  await page.screenshot({ path: `${out}/04-sound-map.png` });
  record(
    "Aircraft follow distinct routes on their scheduled starts and reveal sound-arrival history",
  );
  await button("ひと休み").click();
  const stopped = (await state()).elapsedMs;
  if (development) await step(2000);
  else await page.waitForTimeout(400);
  assert.equal((await state()).elapsedMs, stopped);
  await button("航路を描き直す").click();
  assert.deepEqual((await state()).show, expected);
  await button("← 単体の航路へ").click();
  assert.equal((await state()).show, null);
  await button("演目をつくる →").click();
  await button("この演目を反映").click();
  assert.deepEqual((await state()).show, expected);
  record(
    "Pause freezes the whole show; returning to single-route editing preserves a reusable show draft",
  );
  await button("リセット").click();
  assert.equal((await state()).show, null);
  assert.equal((await state()).airspace.aircraftCount, 1);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/results.json`,
    JSON.stringify({ url, checks, errors, final: await state() }, null, 2),
  );
  console.log(`${checks.length} show scenarios passed`);
} finally {
  await browser.close();
}
