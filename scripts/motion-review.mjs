import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const out = "docs/concepts/2026-09-17-hand-controls";
await fs.mkdir(out, { recursive: true });
await fs.mkdir("output/motion-review", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const errors = [],
  items = [];
const styles = [
  ["lift", "浮上", "ふわっと浮かび、静かに収まる。普段の操作の第一候補。"],
  ["trail", "航跡", "細い線と順番に現れるボタン。航空機らしさを比較。"],
  ["ripple", "音の波", "波紋から面が広がる。聴き方の操作などへの候補。"],
];
try {
  for (const [id, name, detail] of styles) {
    const asset = `${String(styles.findIndex(s => s[0] === id) + 3).padStart(2, "0")}-motion-${id}`;
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: {
        dir: "output/motion-review",
        size: { width: 1440, height: 900 },
      },
    });
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto("http://127.0.0.1:5173/?ui=components");
    await p.waitForFunction(() => !!window.render_game_to_text);
    await p.locator(`[data-style="${id}"]`).click();
    await p.locator('[data-action="flight.start"]').click();
    await p.evaluate(() => window.advanceTime(10000));
    await p.waitForTimeout(650);
    await p.locator('[data-action="menu.toggle"]').click();
    await p.waitForTimeout(160);
    await p.screenshot({ path: `output/motion-review/${id}-entering.png` });
    await p.waitForTimeout(850);
    assert.equal(
      await p
        .locator("#av-control-panel")
        .evaluate((el) => getComputedStyle(el).opacity),
      "1",
    );
    assert.equal(await p.evaluate(() => scrollY), 0, "Menu focus must not scroll the scene");
    assert.equal(await p.locator("main").evaluate(el => el.scrollTop), 0, "The canvas container must not scroll during button focus");
    await p.screenshot({ path: `${out}/${asset}.png` });
    await p.locator('[data-action="menu.sound"]').click();
    await p.waitForTimeout(650);
    await p.locator('[data-action="sound.louder"]').click();
    await p.waitForTimeout(700);
    await p.locator('[data-action="menu.toggle"]').click();
    await p.waitForTimeout(650);
    await p.locator('[data-action="menu.toggle"]').click();
    await p.waitForTimeout(900);
    // Start/close midway and reduced motion must leave no hidden controls active.
    await p.evaluate(() => {
      const b = document.querySelector('[data-action="menu.toggle"]');
      b.click();
      b.click();
      b.click();
    });
    assert.equal(
      await p.locator("#av-control-panel").evaluate((el) => el.inert),
      true,
    );
    const video = p.video();
    await context.close();
    await video.saveAs(path.resolve(`${out}/${asset}.webm`));
    items.push({
      id,
      title: `▶ ${name}｜実装画面の録画。${detail} 音声なし。クリックで動画。`,
      output: `${asset}.png`,
      href: `${asset}.webm`,
      status: "browser-recording",
      routeName: "CSSの開閉比較",
    });
    console.log(`Captured ${id}`);
  }
  for (const [id, title] of [
    [
      "01-vr-pinch",
      "VR｜遠くは指してつまむ、手元に操作盤。将来の画面案・実機撮影ではありません。",
    ],
    [
      "02-ar-touch",
      "AR｜目の前のメニューへ指で触れる。架空の会場・将来の画面案。",
    ],
  ]) {
    items.push({
      id,
      title,
      output: `${id}.png`,
      href: `${id}.png`,
      prompt: await fs.readFile(`${out}/${id}-prompt.txt`, "utf8"),
      status: "concept-not-implemented",
      routeName: "手で操作する空間",
    });
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(`${out}/manifest.json`, JSON.stringify(items, null, 2));
  await fs.writeFile(
    `${out}/review-options.json`,
    JSON.stringify(
      {
        preset: "moodboard",
        title: "AIRPLANEVOICE — 動き3案の動画と、手で触れるVR／ARの画面案",
        showCaptions: true,
        showControls: false,
        minTileWidth: 320,
        output: "review-board.html",
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    "output/motion-review/results.json",
    JSON.stringify({ styles: styles.map((s) => s[0]), errors }, null, 2),
  );
} finally {
  await browser.close();
}
