import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = process.env.SHARED_URL || "http://127.0.0.1:8787/";
const out = "output/hangar";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}?shared=1`);
  await page
    .getByRole("button", { name: "展示用の部屋をつくる（8時間）", exact: true })
    .click();
  const ready = () =>
    page.waitForFunction(() => {
      if (!window.render_game_to_text) return false;
      const r = JSON.parse(window.render_game_to_text()).room;
      return r.status === "connected" && !r.pending;
    });
  await ready();
  await page
    .getByRole("button", { name: "頭上を通る一機を準備", exact: true })
    .click();
  await ready();
  await page.getByLabel("低い厚み", { exact: true }).fill("95");
  await page
    .getByRole("button", { name: "音色を次の飛行に反映", exact: true })
    .click();
  await ready();
  for (let i = 1; i <= 4; i++) {
    await page.getByLabel("保存する機体の名前").fill(`テスト旅客機${i}`);
    await page
      .getByRole("button", { name: "今の設定を名前付きで保存", exact: true })
      .click();
    await page
      .getByRole("button", { name: "部屋へ登録", exact: true })
      .nth(i - 1)
      .click();
    await page.waitForFunction(
      (n) => JSON.parse(window.render_game_to_text()).hangar.length === n,
      i,
    );
    await ready();
  }
  await page.reload();
  await ready();
  assert.equal(
    await page.getByRole("button", { name: "部屋へ登録", exact: true }).count(),
    4,
  );
  const peer = await browser.newPage();
  await peer.goto(page.url());
  await peer.waitForFunction(
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).room.status === "connected",
  );
  await page
    .getByRole("button", { name: "格納庫のみんなを飛ばす", exact: true })
    .click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).fleet.length === 3,
  );
  await peer.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).fleet.length === 3,
  );
  const state = await page.evaluate(() =>
    JSON.parse(window.render_game_to_text()),
  );
  assert.equal(state.fleet[2].design.sound.body, 0.95);
  const other = await peer.evaluate(() =>
    JSON.parse(window.render_game_to_text()),
  );
  assert.equal(other.playbackId, state.playbackId);
  assert.deepEqual(other.hangar, state.hangar);
  await page.getByLabel("低い厚み", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/creation-shelf.png` });
  await page
    .getByRole("button", { name: "機体の方を向く", exact: true })
    .click();
  await page.screenshot({ path: `${out}/shared-sky.png` });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        checks: [
          "overhead preparation",
          "sound persisted",
          "four named aircraft saved and restored",
          "room collection synchronized",
          "three aircraft share one flight",
          "per-aircraft sound retained",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log("PASS: six hangar browser checks; no page errors");
} finally {
  await browser.close();
}
