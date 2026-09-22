import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
await fs.mkdir("output/motion-v2", { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5173/?ui=motion");
  const range = page.getByRole("slider", { name: "再生位置" });
  for (const title of ["翼がひらく", "フライバイ", "音の到着"]) {
    await page.getByRole("button", { name: title, exact: true }).click();
    await range.fill("81");
    await page.screenshot({ path: `output/motion-v2/live-${title}.png` });
  }
  await page.getByRole("button", { name: "VRの見え方" }).click();
  await page.getByRole("button", { name: "フライバイ", exact: true }).click();
  await range.fill("150");
  await page.screenshot({ path: "output/motion-v2/live-vr.png" });
  await page.getByRole("button", { name: "▶ 最初から再生" }).click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).seconds > 1,
  );
  await page.getByRole("button", { name: "一時停止" }).click();
  const frozen = JSON.parse(
    await page.evaluate(() => window.render_game_to_text()),
  ).seconds;
  await page.waitForTimeout(100);
  assert.equal(
    JSON.parse(await page.evaluate(() => window.render_game_to_text())).seconds,
    frozen,
  );
  await page.getByRole("checkbox", { name: "動きを減らす" }).check();
  await range.fill("81");
  assert.equal(
    JSON.parse(await page.evaluate(() => window.render_game_to_text())).reduced,
    true,
  );
  await page.getByRole("button", { name: "♪ 音付きで再生" }).click();
  await page.waitForFunction(() => {
    const a = document.querySelector("audio");
    return !a.paused && a.currentTime > 0.1;
  });
  await page.getByRole("button", { name: "一時停止" }).click();
  assert(await page.locator("audio").evaluate((a) => a.paused));
  if (process.env.MOTION_BOARD_URL) {
    await page.goto(process.env.MOTION_BOARD_URL);
    for (const id of ["pc", "vr"]) {
      await page.locator(`#${id}`).click();
      await page.locator("#all").click();
      await page.waitForFunction(() =>
        [...document.querySelectorAll("#cards video")].every(
          (v) => v.currentTime > 1.2,
        ),
      );
      await page.evaluate(() =>
        document.querySelectorAll("video").forEach((v) => v.pause()),
      );
      await page.screenshot({
        path: `output/motion-v2/board-${id}.png`,
        fullPage: true,
      });
      const times = await page
        .locator("#cards video")
        .evaluateAll((vs) => vs.map((v) => v.currentTime));
      assert(Math.max(...times) - Math.min(...times) < 0.2);
      assert.equal(await page.locator("#cards video").count(), 3);
    }
    await page.locator("#slow").click();
    assert.equal(
      await page
        .locator("#cards video")
        .first()
        .evaluate((v) => v.playbackRate),
      0.5,
    );
    await page.getByRole("button", { name: "この案を大きく" }).first().click();
    await page.waitForFunction(
      () => document.querySelector("#large").currentTime > 0.5,
    );
    assert(
      (await page.locator("#large").getAttribute("src")).includes("vr-lift"),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: "output/motion-v2/board-mobile.png",
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "output/motion-v2/browser-results.json",
    JSON.stringify(
      {
        checks: [
          "3 style intermediate poses",
          "VR overview",
          "play/pause/seek",
          "reduced motion",
          "explicit sound start and stop",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "OK motion theatre: 3 styles, VR view, seek, playback, reduced motion, opt-in audio; no page errors.",
  );
} finally {
  await browser.close();
}
