import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const url = process.env.TEST_URL || "http://127.0.0.1:5173/";
const out = process.env.TRANSFER_OUTPUT || "output/transfer";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const errors = [],
  checks = [];
const record = (name) => {
  checks.push(name);
  console.log(`OK ${name}`);
};
const state = (page) =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
const ready = (page) =>
  page.waitForFunction(() => typeof window.render_game_to_text === "function");
const button = (page, name) => page.getByRole("button", { name, exact: true });
const share = async (page) => {
  await button(page, "この空をQuestへ渡す").click();
  await page.getByLabel("渡すURL", { exact: true }).waitFor();
  return page.getByLabel("渡すURL", { exact: true }).inputValue();
};
const watch = (page) => {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
};
const localLink = (link) => url.replace(/#.*$/, "") + new URL(link).hash;
const storage = (page) => page.evaluate(() => ({ ...localStorage }));
const sameSky = (a, b) => {
  for (const key of [
    "checksum",
    "routeId",
    "generator",
    "flightSettings",
    "aircraftDesign",
    "airspace",
    "listener",
  ])
    assert.deepEqual(a[key], b[key], key);
  assert.equal(a.evolution.enabled, b.evolution.enabled);
  assert.equal(a.evolution.amount, b.evolution.amount);
};
let receiver;
try {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  const pc = await context.newPage();
  watch(pc);
  await pc.goto(url);
  await ready(pc);
  if (await pc.evaluate(() => typeof window.advanceTime === "undefined")) {
    await pc.waitForFunction(
      () =>
        JSON.parse(window.render_game_to_text()).offline.ready &&
        !!navigator.serviceWorker.controller,
    );
    await context.setOffline(true);
    await pc.reload();
    await ready(pc);
    await share(pc);
    await pc
      .getByAltText("この空の設定を開くQRコード", { exact: true })
      .waitFor();
    await button(pc, "空の受け渡しを閉じる").click();
    await context.setOffline(false);
    record(
      "Cached production bundle generates QR on its first offline use, including the lazy QR module",
    );
  }
  await button(pc, "つくる実験室 →").click();
  await pc.getByRole("slider", { name: "翼の幅", exact: true }).fill("77");
  await button(pc, "2基").click();
  await button(pc, "2 航路").click();
  await button(pc, "この2点で航路を作る").click();
  await button(pc, "3機").click();
  await pc.getByLabel("飛び始める間隔", { exact: true }).selectOption("16");
  await pc
    .getByRole("checkbox", {
      name: "周回ごとに変化して飛び続ける",
      exact: true,
    })
    .check();
  await pc
    .getByRole("slider", { name: "周回の変化の幅", exact: true })
    .fill("0.85");
  await button(pc, "丘の上").click();
  const expected = await state(pc);
  const link = await share(pc);
  const qr = pc.getByAltText("この空の設定を開くQRコード", { exact: true });
  await qr.waitFor();
  await pc.addScriptTag({
    content: await fs.readFile("node_modules/jsqr/dist/jsQR.js", "utf8"),
  });
  const decoded = await qr.evaluate(async (img) => {
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return jsQR(
      ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width,
      canvas.height,
    )?.data;
  });
  assert.equal(decoded, link);
  await pc.screenshot({ path: `${out}/01-pc-share.png`, fullPage: true });
  record(
    "Created aircraft and generated route produce an independently decoded QR matching the URL",
  );
  await pc.evaluate(() =>
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new Error("test denial")),
    }),
  );
  await button(pc, "URLをコピー").click();
  assert.match(
    await pc.getByRole("dialog").getByRole("status").innerText(),
    /URLを選択/,
  );
  assert(
    await pc
      .getByLabel("渡すURL", { exact: true })
      .evaluate((t) => t.selectionEnd - t.selectionStart === t.value.length),
  );
  record("Denied clipboard selects the complete URL for manual copying");
  await pc.keyboard.press("Escape");
  assert.equal((await state(pc)).phase, "EDIT");
  await pc.reload();
  await ready(pc);
  sameSky(await state(pc), expected);
  record(
    "PC settings persist across reload, including count, evolution and observer",
  );

  const receivingContext = await browser.newContext({
    viewport: { width: 1000, height: 800 },
  });
  receiver = await receivingContext.newPage();
  watch(receiver);
  await receiver.goto(url);
  await ready(receiver);
  const original = await state(receiver),
    originalStorage = await storage(receiver);
  await receiver.goto(localLink(link));
  await button(receiver, "この空を取り込む").waitFor();
  sameSky(await state(receiver), original);
  assert.deepEqual(await storage(receiver), originalStorage);
  await button(receiver, "今の空を続ける").click();
  sameSky(await state(receiver), original);
  assert.equal(new URL(receiver.url()).hash, "");
  record(
    "A separate receiver previews and cancels without changing the current sky or stored data",
  );
  await receiver.goto(localLink(link));
  await button(receiver, "この空を取り込む").click();
  sameSky(await state(receiver), expected);
  assert.equal((await state(receiver)).phase, "EDIT");
  assert.equal((await state(receiver)).audio.state, "locked");
  assert.equal((await state(receiver)).mixMode, "balanced");
  await receiver.reload();
  await ready(receiver);
  sameSky(await state(receiver), expected);
  record(
    "Explicit import restores all settings, stays stopped and survives reload on the receiver",
  );
  await receiver.setViewportSize({ width: 390, height: 844 });
  await receiver.goto(localLink(link));
  await button(receiver, "この空を取り込む").waitFor();
  const box = await receiver.getByRole("dialog").boundingBox();
  assert(box.x >= 0 && box.x + box.width <= 390);
  assert(
    await receiver.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await receiver.screenshot({
    path: `${out}/02-mobile-receive.png`,
    fullPage: true,
  });
  await button(receiver, "今の空を続ける").click();
  record("Receive preview and actions fit a 390px screen");
  await receiver.setViewportSize({ width: 1000, height: 800 });
  await receiver.locator("#start-btn").click();
  await receiver.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).phase === "FLY",
  );
  await button(receiver, "ひと休み").click();
  const flying = await state(receiver);
  await receiver.goto(localLink(link));
  await button(receiver, "この空を取り込む").waitFor();
  assert(await button(receiver, "この空を取り込む").isDisabled());
  await receiver.keyboard.press("Escape");
  const after = await state(receiver);
  assert.equal(after.phase, "FLY");
  assert.equal(after.paused, true);
  assert.equal(after.elapsedMs, flying.elapsedMs);
  record(
    "A received link cannot replace a running or paused flight; closing the preview preserves it",
  );
  await button(receiver, "航路を描き直す").click();
  await receiver.goto(url + "#sky=2.invalid");
  await receiver.getByRole("alert").waitFor();
  assert.equal(await button(receiver, "この空を取り込む").count(), 0);
  await button(receiver, "今の空を続ける").click();
  assert.equal((await state(receiver)).checksum, expected.checksum);
  record("Invalid links show a recoverable error without changing the sky");
  await receiver.evaluate(() =>
    Object.defineProperty(Storage.prototype, "setItem", {
      configurable: true,
      value() {
        throw new Error("test blocked storage");
      },
    }),
  );
  await receiver.goto(localLink(link));
  await button(receiver, "この空を取り込む").click();
  assert.match(
    await receiver.locator(".toast").innerText(),
    /保存はできません/,
  );
  assert.equal((await state(receiver)).checksum, expected.checksum);
  record("Import remains playable when browser storage is blocked");
  await receiver.reload();
  await ready(receiver);
  await button(receiver, "リセット").click();
  await receiver.reload();
  await ready(receiver);
  assert.equal((await state(receiver)).airspace.aircraftCount, 1);
  assert.equal((await state(receiver)).evolution.enabled, false);
  assert.deepEqual((await state(receiver)).listener, original.listener);
  record(
    "Reset persists default options instead of the previous imported observer",
  );
  await pc.evaluate(() => {
    const rawPoints = Array.from({ length: 220 }, (_, i) => ({
      x: Math.sin((i / 220) * Math.PI * 2) * 900,
      y: 240 + 14 * Math.sin((i / 220) * Math.PI * 6),
      z: -1400 + 850 * Math.cos((i / 220) * Math.PI * 2),
    }));
    localStorage.setItem(
      "sound-trail.desktop.route.v1",
      JSON.stringify({ id: "drawn", revision: 1, closed: true, rawPoints }),
    );
  });
  await pc.reload();
  await ready(pc);
  const longLink = await share(pc);
  assert(longLink.length > 1800);
  await pc
    .getByText("この航路はQRに収まりません。URLをコピーして渡せます。", {
      exact: true,
    })
    .waitFor();
  assert.equal(await qr.count(), 0);
  await receiver.goto(localLink(longLink));
  await button(receiver, "この空を取り込む").click();
  assert.equal((await state(receiver)).checksum, (await state(pc)).checksum);
  record(
    "Detailed freehand routes fall back to URL transfer and round trip without lost points",
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/results.json`,
    JSON.stringify(
      {
        url,
        checks,
        errors,
        qrLength: link.length,
        longLength: longLink.length,
      },
      null,
      2,
    ),
  );
  console.log(
    `${checks.length} transfer scenarios passed; physical Quest opening remains a user check.`,
  );
} finally {
  if (receiver)
    await receiver
      .screenshot({ path: `${out}/last-receiver.png`, fullPage: true })
      .catch(() => {});
  await browser.close();
}
