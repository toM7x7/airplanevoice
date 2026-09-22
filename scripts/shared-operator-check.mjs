import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = process.env.SHARED_URL || "http://127.0.0.1:8787/";
const out = "output/shared-operator";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ],
});
const checks = [],
  errors = [];
const ok = (s) => {
  checks.push(s);
  console.log("OK", s);
};
const state = (p) => p.evaluate(() => JSON.parse(window.render_game_to_text()));
const wait = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 45000 });
const frames = async (p, n = 3) => {
  const until = (await state(p)).vr.frames + n;
  await wait(
    p,
    (n) => JSON.parse(window.render_game_to_text()).vr.frames >= n,
    until,
  );
};
const ready = (p) =>
  wait(
    p,
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).room.status === "connected",
  );
let p;
try {
  const pc = await browser.newContext({
      viewport: { width: 1000, height: 800 },
    }),
    a = await pc.newPage();
  await a.goto(new URL("?shared=1", base).href);
  await a
    .getByRole("button", { name: "展示用の部屋をつくる（8時間）" })
    .click();
  await ready(a);
  await a.locator(".venue-panel summary").click();
  await a.getByLabel("基準点の間隔").fill("1.2");
  await a.getByLabel("机の奥行き").fill("0.6");
  await a.getByRole("button", { name: "会場の配置を共有に保存" }).click();
  await wait(a, () => !JSON.parse(window.render_game_to_text()).room.pending);
  await a.locator("#shared-launch").click();
  await wait(
    a,
    () =>
      JSON.parse(window.render_game_to_text()).room.state.flights.length > 0,
  );
  const before = (await state(a)).room.state;
  const xr = await browser.newContext({
    viewport: { width: 1000, height: 750 },
  });
  const emulation = await fs.readFile(
    "node_modules/iwer/build/iwer.min.js",
    "utf8",
  );
  await xr.addInitScript({
    content: `${emulation}\nwindow.xrDevice=new IWER.XRDevice(IWER.metaQuest3,{stereoEnabled:true});xrDevice.installRuntime({forceInstall:true,polyfillLayers:false});xrDevice.controlMode='programmatic';xrDevice.position.set(4,1.25,3);xrDevice.primaryInputMode='hand';const original=XRSession.prototype.requestReferenceSpace;XRSession.prototype.requestReferenceSpace=async function(type){const s=await original.call(this,type);if(type==='local-floor')window.testFloor=s;return s;};`,
  });
  p = await xr.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  a.on("pageerror", (e) => errors.push(e.message));
  await p.goto(a.url());
  await ready(p);
  await p.locator("#vr-enter").click();
  await wait(
    p,
    () =>
      JSON.parse(window.render_game_to_text()).vr.inputMode === "hands" &&
      JSON.parse(window.render_game_to_text()).vr.frames > 8,
  );
  const target = async (label) => {
    await wait(p, () =>
      [0, 1].includes(
        JSON.parse(window.render_game_to_text()).vr.controls.progress,
      ),
    );
    const v = (await state(p)).vr,
      b = v.controls.targets.find((b) => b.label === label || b.id === label);
    assert(b?.enabled, `Missing target ${label}`);
    const m = v.panel.matrix,
      x = ((b.x + b.w / 2) / 1024 - 0.5) * 2.4,
      y = (0.5 - (b.y + b.h / 2) / 512) * 1.2;
    return {
      world: [
        m[0] * x + m[4] * y + m[12],
        m[1] * x + m[5] * y + m[13],
        m[2] * x + m[6] * y + m[14],
      ],
      normal: [m[8], m[9], m[10]].map((q) => q / Math.hypot(m[8], m[9], m[10])),
    };
  };
  const raw = (world, v, vector = false) => {
    const d = world.map((q, i) => q - (vector ? 0 : v.origin[i])),
      c = Math.cos(v.yaw),
      s = Math.sin(v.yaw);
    return [c * d[0] - s * d[2], d[1], s * d[0] + c * d[2]];
  };
  const pinch = async (label) => {
    const t = await target(label),
      v = (await state(p)).vr;
    await p.evaluate(
      ({ goal, head }) => {
        const h = xrDevice.hands.right,
          pos = [head[0] + 0.18, head[1] - 0.25, head[2] - 0.1];
        h.position.set(...pos);
        const d = goal.map((q, i) => q - pos[i]),
          len = Math.hypot(...d),
          [x, y, z] = d.map((q) => q / len),
          n = Math.hypot(y, -x, 1 - z);
        h.quaternion.set(y / n, -x / n, 0, (1 - z) / n);
      },
      { goal: raw(t.world, v), head: v.rawHead },
    );
    await frames(p);
    await p.evaluate(() => xrDevice.hands.right.updatePinchValue(1));
    await frames(p);
    await p.evaluate(() => xrDevice.hands.right.updatePinchValue(0));
    await frames(p);
  };
  assert.equal((await state(p)).vr.showCalibration, false);
  await pinch("見え方・操作案内");
  await pinch("机と会場");
  await pinch("机の枠を目の前へ");
  let s = await state(p);
  assert.equal(s.vr.calibration, "placing");
  assert(Math.abs(s.vr.placement.a.x - 3.4) < 1e-5);
  assert(Math.abs(s.vr.placement.a.z - 2.35) < 1e-5);
  assert.equal(s.vr.table.tableDepthM, 0.6);
  assert.equal(s.vr.alignmentCheck, null);
  const initial = structuredClone(s.vr.placement);
  await pinch("右へ 5 cm →");
  await pinch("手前へ 5 cm");
  await pinch("右回り 5°");
  await pinch("高さの調整・配置の確定");
  await pinch("↑ 高く 2 cm");
  await pinch("この位置で使う（目視）");
  s = await state(p);
  assert.equal(s.vr.calibration, "placed");
  assert.equal(s.vr.alignmentCheck, null);
  assert(Math.abs(s.vr.placement.a.y - initial.a.y - 0.02) < 1e-5);
  assert(Math.abs(s.vr.placement.yaw + Math.PI / 36) < 1e-5);
  assert.deepEqual(s.room.state.flights, before.flights);
  assert.equal(s.room.state.revision, before.revision);
  await wait(a, () =>
    JSON.parse(window.render_game_to_text()).room.participants.some(
      (p) => p.presence?.calibration === "placed",
    ),
  );
  await p.screenshot({ path: `${out}/01-table-controls.png` });
  ok(
    "Hand pinch places ABCD near a displaced operator, adjusts all axes/yaw, reports manual confirmation without changing the shared flight",
  );
  await pinch("メニューを閉じて確認");
  await frames(p, 12);
  assert.equal((await state(p)).vr.controls.open, false);
  await p.screenshot({ path: `${out}/02-table-dock.png` });
  await pinch("dock.menu");
  assert.equal((await state(p)).vr.controls.open, true);
  await pinch("机と会場に戻る");
  await pinch("見え方・操作案内");
  await pinch("音の設定");
  const louderLabel = (await state(p)).vr.controls.targets.find((t) =>
    t.label.includes("＋5"),
  ).label;
  const t = await target(louderLabel),
    volume = (await state(p)).audio.volume;
  const moveTip = async (depth) => {
    const v = (await state(p)).vr,
      tip = v.hands.find((h) => h.hand === "right").tip;
    assert(tip);
    const delta = raw(
      t.world.map((q, i) => q + t.normal[i] * depth - tip[i]),
      v,
      true,
    );
    await p.evaluate((d) => {
      const h = xrDevice.hands.right;
      h.position.set(
        h.position.x + d[0],
        h.position.y + d[1],
        h.position.z + d[2],
      );
    }, delta);
    await frames(p);
  };
  await moveTip(0.07);
  await moveTip(0.004);
  assert.equal((await state(p)).audio.volume, volume + 5);
  await frames(p, 12);
  assert.equal((await state(p)).audio.volume, volume + 5);
  await p.evaluate(() => xrDevice.hands.right.updatePinchValue(1));
  await frames(p);
  assert.equal((await state(p)).audio.volume, volume + 5);
  await p.evaluate(() => xrDevice.hands.right.updatePinchValue(0));
  await frames(p);
  await moveTip(0.07);
  await moveTip(0.004);
  assert.equal((await state(p)).audio.volume, volume + 10);
  await p.screenshot({ path: `${out}/03-hand-sound.png` });
  ok(
    "Collapsed dock reopens by pinch; direct finger touch works once per approach and ignores near-pinch duplicates",
  );
  await a.getByLabel("共有高度を上げる").click();
  await wait(
    p,
    (n) => JSON.parse(window.render_game_to_text()).room.state.revision > n,
    before.revision,
  );
  assert.equal((await state(p)).vr.calibration, "placed");
  ok("PC edits reach the Quest while its local placement remains intact");
  await pinch("空の操作へ");
  await pinch("見え方・操作案内");
  await pinch("机と会場");
  await pinch("会場の地点へ");
  await pinch("地図の見え方");
  await pinch("小さな地図で見る");
  await frames(p, 12);
  assert.equal((await state(p)).vr.panelVisible, false);
  assert.equal((await state(p)).vr.showVenue, true);
  await p.screenshot({ path: `${out}/04-map-with-dock.png` });
  await pinch("dock.menu");
  assert.equal((await state(p)).vr.panelVisible, true);
  ok(
    "Persistent dock does not hide the miniature map when the menu is collapsed",
  );
  await a.getByLabel("机の奥行き").fill("0.8");
  await a.getByRole("button", { name: "会場の配置を共有に保存" }).click();
  await wait(
    p,
    () => JSON.parse(window.render_game_to_text()).vr.calibration === "lost",
  );
  await pinch("机の枠を目の前へ");
  assert.equal((await state(p)).vr.table.tableDepthM, 0.8);
  await pinch("高さの調整・配置の確定");
  await pinch("この位置で使う（目視）");
  assert.equal((await state(p)).vr.calibration, "placed");
  ok(
    "A PC depth change invalidates the local placement and can be placed again with hands",
  );
  await p.evaluate(() => (xrDevice.primaryInputMode = "controller"));
  await frames(p);
  assert.equal((await state(p)).vr.inputMode, "controllers");
  await p.evaluate(() => testFloor.dispatchEvent(new Event("reset")));
  await frames(p);
  assert.equal((await state(p)).vr.calibration, "lost");
  assert.equal((await state(p)).vr.placement, null);
  ok(
    "Controller fallback works; a reference reset invalidates the manual placement",
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/results.json`,
    JSON.stringify({ checks, errors }, null, 2),
  );
} catch (error) {
  if (p) {
    await p.screenshot({ path: `${out}/failure.png` }).catch(() => {});
    await fs
      .writeFile(`${out}/failure.json`, JSON.stringify(await state(p), null, 2))
      .catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
}
