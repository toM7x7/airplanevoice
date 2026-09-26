import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const base = process.env.SHARED_URL || "http://127.0.0.1:8787/";
const out = process.env.SPATIAL_OUTPUT || "output/spatial";
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
const errors = [],
  checks = [];
const ok = (name) => {
  checks.push(name);
  console.log(`OK ${name}`);
};
const state = (p) => p.evaluate(() => JSON.parse(window.render_game_to_text()));
const wait = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 30000 });
const ready = (p) =>
  wait(
    p,
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).room.status === "connected",
  );
const settle = (p) =>
  wait(p, () => !JSON.parse(window.render_game_to_text()).room.pending);
async function frames(p) {
  const n = (await state(p)).vr.frames + 2;
  await wait(
    p,
    (n) => {
      const v = JSON.parse(window.render_game_to_text()).vr;
      return v.status === "ready" || v.frames >= n;
    },
    n,
  );
}
async function trigger(p) {
  await frames(p);
  await p.evaluate(() =>
    xrDevice.controllers.right.updateButtonValue("trigger", 1),
  );
  await frames(p);
  await p.evaluate(() =>
    xrDevice.controllers.right.updateButtonValue("trigger", 0),
  );
  await frames(p);
}
async function button(p, col, row) {
  await p.bringToFront();
  await wait(
    p,
    () => JSON.parse(window.render_game_to_text()).vr.controls.progress === 1,
  );
  const { panel, origin, yaw, controls } = (await state(p)).vr,
    m = panel.matrix;
  const hit = controls.targets.filter((t) => t.id.startsWith("action:"))[
    row * 2 + col
  ];
  const x = ((hit.x + hit.w / 2) / 1024 - 0.5) * panel.width;
  const y = (0.5 - (hit.y + hit.h / 2) / 512) * panel.height;
  const world = [
    m[0] * x + m[4] * y + m[12],
    m[1] * x + m[5] * y + m[13],
    m[2] * x + m[6] * y + m[14],
  ];
  const q = world.map((v, i) => v - origin[i]),
    c = Math.cos(yaw),
    s = Math.sin(yaw);
  const local = [c * q[0] - s * q[2], q[1], s * q[0] + c * q[2]];
  await p.evaluate((target) => {
    const controller = xrDevice.controllers.right;
    controller.position.set(0.25, 1.3, -0.2);
    const d = target.map((v, i) => v - [0.25, 1.3, -0.2][i]),
      len = Math.hypot(...d);
    const [x, y, z] = d.map((v) => v / len),
      norm = Math.hypot(y, -x, 1 - z);
    controller.quaternion.set(y / norm, -x / norm, 0, (1 - z) / norm);
  }, local);
  await trigger(p);
}
async function capture(p, position) {
  await p.bringToFront();
  await p.evaluate((position) => {
    const c = xrDevice.controllers.right;
    c.position.set(...position);
    c.quaternion.set(0, 0, 0, 1);
  }, position);
  await trigger(p);
}
let rawSocket;
try {
  const pc = await browser.newContext({
      viewport: { width: 1440, height: 980 },
    }),
    a = await pc.newPage();
  a.on("pageerror", (e) => errors.push(e.message));
  await a.goto(new URL("?shared=1", base).href);
  await a
    .getByRole("button", { name: "展示用の部屋をつくる（8時間）" })
    .click();
  await ready(a);
  const operator = a.url();
  await fs.writeFile(`${out}/invite.json`, JSON.stringify({ operator }));
  await a.locator(".venue-panel summary").click();
  await a.getByLabel("地点1の名前").fill("受付");
  await a.getByLabel("地点1のx", { exact: true }).fill("-2");
  await a.getByRole("button", { name: "会場の配置を共有に保存" }).click();
  await settle(a);
  assert.equal((await state(a)).room.state.venue.points[0].name, "受付");
  await a.getByRole("button", { name: "基準点を見る", exact: true }).click();
  await a.getByRole("button", { name: "実寸の地点を見る" }).click();
  await a.screenshot({ path: `${out}/01-map.png` });
  ok("PC registers and saves the measured coordinate map");
  const beforeOverview = await state(a);
  await a.getByRole("button", { name: "小さな地図で見る" }).click();
  await wait(
    a,
    () => JSON.parse(window.render_game_to_text()).vr.venueView === "overview",
  );
  await a.waitForTimeout(800);
  const afterOverview = await state(a);
  assert.equal(
    afterOverview.room.state.revision,
    beforeOverview.room.state.revision,
  );
  assert.deepEqual(
    afterOverview.room.state.venue,
    beforeOverview.room.state.venue,
  );
  assert.deepEqual(afterOverview.audio.listener, beforeOverview.audio.listener);
  await a.screenshot({ path: `${out}/01b-overview.png` });
  await a.getByRole("button", { name: "地図を隠す", exact: true }).click();
  assert.equal((await state(a)).vr.showVenue, false);
  ok("PC overview and hide preserve shared coordinates, revision and listener");
  await a.locator("#shared-launch").click();
  await settle(a);
  const flight = (await state(a)).room.state.flights[0];
  const emulation = await fs.readFile(
    "node_modules/iwer/build/iwer.min.js",
    "utf8",
  );
  const pages = [];
  for (const model of ["metaQuest3", "metaQuest2"]) {
    const context = await browser.newContext({
      viewport: { width: 640, height: 480 },
    });
    await context.addInitScript({
      content: `${emulation}\nwindow.xrDevice=new IWER.XRDevice(IWER.${model},{stereoEnabled:true}); xrDevice.installRuntime({forceInstall:true,polyfillLayers:false}); xrDevice.controlMode='programmatic'; xrDevice.position.set(0,1.65,0); const original=XRSession.prototype.requestReferenceSpace; XRSession.prototype.requestReferenceSpace=async function(type){const space=await original.call(this,type); if(type==='local-floor')window.testFloor=space; return space;};`,
    });
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(operator);
    await ready(p);
    await p.locator("#vr-enter").click();
    console.log(`Checking ${model} controls`);
    await wait(p, () => JSON.parse(window.render_game_to_text()).vr.frames > 4);
    await button(p, 0, 3); // main → view
    await button(p, 0, 2); // view → spatial
    assert.match((await state(p)).vr.sharedPage, /位置合わせ/);
    await button(p, 0, 1); // spatial → optional measured alignment
    pages.push(p);
  }
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    await button(p, 0, 0);
    console.log(`Calibrating headset ${i + 1}`);
    assert.equal((await state(p)).vr.calibration, "a");
    const A = i === 0 ? [2, 0.8, -3] : [-1, 0.8, 1],
      B = i === 0 ? [2.6, 0.8, -3] : [-1.6, 0.8, 1];
    await capture(p, A);
    assert.equal((await state(p)).vr.calibration, "b");
    await capture(p, B);
    assert.equal((await state(p)).vr.calibration, "c");
    const C = [A[0], A[1], A[2] + (i === 0 ? -0.6 : 0.6)];
    if (i === 0) {
      await capture(p, [C[0], C[1], C[2] + 0.2]);
      assert.equal((await state(p)).vr.alignmentCheck.acceptable, false);
      await button(p, 1, 0);
      assert.equal((await state(p)).vr.calibration, "checking");
      await button(p, 0, 0);
      await capture(p, A);
      await capture(p, B);
      ok("A C-point error over 5 cm cannot be confirmed; capture can restart");
    }
    // Independent point exposes swapped direction without altering the shared flight.
    await capture(p, C);
    assert.equal((await state(p)).vr.calibration, "checking");
    assert((await state(p)).vr.alignmentCheck.acceptable);
    const aligned = await state(p),
      { offset, yaw } = aligned.vr.alignment;
    assert(Math.abs(Math.abs(yaw) - (i === 0 ? 0 : Math.PI)) < 1e-5);
    await button(p, 1, 0);
    assert.equal((await state(p)).vr.calibration, "aligned");
    // Move the simulated head; independent physical positions must not collapse to one camera.
    await p.evaluate(
      (pos) => xrDevice.position.set(...pos),
      [A[0] + 0.2, A[1] + 0.9, A[2] + 1],
    );
    await frames(p);
    const s = await state(p),
      raw = [A[0] + 0.2, A[1] + 0.9, A[2] + 1],
      c = Math.cos(yaw),
      sn = Math.sin(yaw);
    const expected = [
      c * raw[0] + sn * raw[2] + offset.x,
      raw[1] + offset.y,
      -sn * raw[0] + c * raw[2] + offset.z,
    ];
    s.vr.head.position.forEach((v, k) =>
      assert(Math.abs(v - expected[k]) < 1e-4),
    );
    assert(Math.abs(s.vr.head.forward[2] - (i === 0 ? -1 : 1)) < 1e-4);
    s.vr.head.position.forEach((v, k) =>
      assert(Math.abs(v - s.audio.listener.position[k]) < 1e-4),
    );
    s.vr.head.forward.forEach((v, k) =>
      assert(Math.abs(v - s.audio.listener.forward[k]) < 1e-4),
    );
    assert.deepEqual(s.room.state.flights[0], flight);
    await p.screenshot({
      path: `${out}/0${i + 2}-aligned-${i === 0 ? "quest3" : "quest2"}.png`,
    });
  }
  ok(
    "Quest 3 and Quest 2 retain distinct viewpoints in the same calibrated metre space",
  );
  const b = pages[0],
    c = pages[1];
  await wait(
    a,
    () =>
      JSON.parse(window.render_game_to_text()).room.participants.filter(
        (p) => p.presence?.calibration === "aligned",
      ).length === 2,
  );
  const participants = (await state(a)).room.participants;
  assert.equal(participants.length, 3);
  assert.equal(new Set(participants.map((p) => p.id)).size, 3);
  await a.locator(".room-alignment").scrollIntoViewIfNeeded();
  await a
    .locator(".room-alignment")
    .screenshot({ path: `${out}/03e-pc-status.png` });
  await b.bringToFront();
  await b.evaluate(() =>
    xrDevice.controllers.right.updateButtonValue("squeeze", 1),
  );
  await frames(b);
  await b.evaluate(() =>
    xrDevice.controllers.right.updateButtonValue("squeeze", 0),
  );
  await frames(b);
  await button(b, 1, 1); // measurement → spatial
  await button(b, 1, 1); // spatial → sync
  assert.match((await state(b)).vr.sharedPage, /PC・Quest/);
  await b.screenshot({ path: `${out}/03d-two-headsets.png` });
  await button(b, 0, 0); // sync → spatial
  ok(
    "Each headset and PC see the same two confirmation reports, independently of room edits",
  );
  await button(b, 0, 2); // spatial → venue
  await button(b, 1, 0); // select booth 2
  await wait(
    c,
    () =>
      JSON.parse(window.render_game_to_text()).room.state.venue.selectedId ===
      "booth-2",
  );
  assert.equal((await state(a)).room.state.venue.selectedId, "booth-2");
  assert.deepEqual((await state(b)).room.state.flights[0], flight);
  ok(
    "VR destination selection syncs to PC and the other Quest without restarting the flight",
  );
  await button(b, 1, 1); // venue → venue-view (3 points)
  assert.match((await state(b)).vr.sharedPage, /会場の見え方/);
  const beforeMap = await state(b);
  const beforePeer = await state(c);
  await button(b, 0, 0); // overview, panel closes
  await frames(b);
  let afterMap = await state(b);
  assert.equal(afterMap.vr.venueView, "overview");
  assert.equal(afterMap.vr.controls.open, false);
  assert.equal(afterMap.vr.showVenue, true);
  assert.deepEqual(afterMap.vr.alignment, beforeMap.vr.alignment);
  assert.deepEqual(afterMap.audio.listener, beforeMap.audio.listener);
  assert.deepEqual(afterMap.room.state.flights[0], flight);
  assert.equal(afterMap.room.state.revision, beforeMap.room.state.revision);
  assert.deepEqual(afterMap.room.state.venue, beforeMap.room.state.venue);
  assert((await state(b)).room.now > beforeMap.room.now);
  assert.equal((await state(c)).vr.showVenue, beforePeer.vr.showVenue);
  await b.screenshot({ path: `${out}/03b-xr-overview.png` });
  await b.evaluate(() =>
    xrDevice.controllers.right.updateButtonValue("squeeze", 1),
  );
  await frames(b);
  await b.evaluate(() =>
    xrDevice.controllers.right.updateButtonValue("squeeze", 0),
  );
  await frames(b);
  assert.equal((await state(b)).vr.controls.open, true);
  await button(b, 1, 1); // AR → virtual, preserving the map
  assert.equal((await state(b)).vr.displayMode, "vr");
  await button(b, 1, 3); // hide panel to see the map in the virtual sky
  await frames(b);
  await b.screenshot({ path: `${out}/03c-xr-overview-vr.png` });
  await b.evaluate(() =>
    xrDevice.controllers.right.updateButtonValue("squeeze", 1),
  );
  await frames(b);
  await b.evaluate(() =>
    xrDevice.controllers.right.updateButtonValue("squeeze", 0),
  );
  await frames(b);
  await button(b, 1, 1); // back to AR
  assert.equal((await state(b)).vr.displayMode, "ar");
  await button(b, 1, 0); // same shared map at actual metres
  afterMap = await state(b);
  assert.equal(afterMap.vr.venueView, "space");
  assert.deepEqual(afterMap.vr.alignment, beforeMap.vr.alignment);
  assert.deepEqual(afterMap.audio.listener, beforeMap.audio.listener);
  await button(b, 0, 1); // hide
  assert.equal((await state(b)).vr.showVenue, false);
  ok(
    "XR miniature, full-scale and hidden views keep flight, calibration and ears unchanged; peers keep their view",
  );
  await button(c, 1, 2); // toggle AR → virtual
  assert.equal((await state(c)).vr.displayMode, "vr");
  assert.equal((await state(c)).vr.calibration, "aligned");
  await button(c, 1, 2);
  assert.equal((await state(c)).vr.displayMode, "ar");
  ok("AR and virtual sky switching retain calibration and the same flight");
  await c.evaluate(() => testFloor.dispatchEvent(new Event("reset")));
  await frames(c);
  assert.equal((await state(c)).vr.calibration, "lost");
  assert.equal((await state(c)).resting, true);
  assert.equal((await state(b)).vr.calibration, "aligned");
  await wait(a, () =>
    JSON.parse(window.render_game_to_text()).room.participants.some(
      (p) => p.presence?.calibration === "lost",
    ),
  );
  ok(
    "A reference reset invalidates only that device and requests recalibration",
  );
  await a.locator(".room-invite summary").click();
  const invite = await a.getByLabel("部屋の招待URL").inputValue();
  await fs.writeFile(
    `${out}/invite.json`,
    JSON.stringify({ operator, invite }),
  );
  const url = new URL(invite),
    endpoint = new URL(
      `/api/rooms/${url.searchParams.get("room")}/connect`,
      base,
    );
  endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
  const messages = [];
  rawSocket = new WebSocket(endpoint, [
    "airplanevoice-room-v1",
    `key.${new URLSearchParams(url.hash.slice(1)).get("key")}`,
  ]);
  rawSocket.onmessage = (e) => messages.push(JSON.parse(e.data));
  await new Promise((res, rej) => {
    rawSocket.onopen = res;
    rawSocket.onerror = rej;
  });
  const snap = await state(a);
  rawSocket.send(
    JSON.stringify({
      type: "ping",
      sentAt: 42,
      id: "spoof",
      presence: {
        mode: "ar",
        calibration: "aligned",
        frame: "0.6/0.75",
        checkErrorM: 0.02,
        head: [1, 2, 3],
      },
    }),
  );
  const presenceDeadline = Date.now() + 5000;
  while (
    !messages.some((m) => m.type === "pong" && m.sentAt === 42) &&
    Date.now() < presenceDeadline
  )
    await new Promise((r) => setTimeout(r, 50));
  const pong = messages.find((m) => m.type === "pong" && m.sentAt === 42);
  assert(pong);
  const self = pong.participants.find((p) => p.id === pong.selfId);
  assert.equal(self.role, "viewer");
  assert.notEqual(self.id, "spoof");
  assert.equal(self.presence.checkErrorM, 0.02);
  assert.equal(self.presence.head, undefined);
  assert.equal((await state(a)).room.state.revision, snap.room.state.revision);
  assert.deepEqual(
    (await state(a)).room.state.flights,
    snap.room.state.flights,
  );
  ok(
    "A viewer reports only its own calibration without changing the shared flight or revision",
  );
  rawSocket.send(
    JSON.stringify({
      type: "venue",
      id: "forbidden-venue",
      revision: snap.room.state.revision,
      venue: snap.room.state.venue,
    }),
  );
  const deadline = Date.now() + 5000;
  while (!messages.some((m) => m.type === "rejected") && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 50));
  assert(messages.some((m) => m.type === "rejected"));
  rawSocket.close();
  ok("Server rejects venue edits from a viewing invitation");
  await button(c, 0, 3); // spatial → view
  await button(c, 0, 3); // view → exit
  await wait(
    c,
    () => JSON.parse(window.render_game_to_text()).vr.status === "ready",
  );
  await c.reload();
  await ready(c);
  assert.equal((await state(c)).room.state.venue.selectedId, "booth-2");
  await c.locator("#vr-enter").click();
  await wait(c, () => JSON.parse(window.render_game_to_text()).vr.frames > 4);
  assert.equal((await state(c)).vr.calibration, "none");
  await wait(
    a,
    () =>
      JSON.parse(window.render_game_to_text()).room.participants.filter(
        (p) => p.presence?.calibration === "aligned",
      ).length === 1,
  );
  ok("Reentry restores the shared map while requiring fresh local calibration");
  const beforeFrameChange = (await state(a)).room.state.flights;
  await a.getByLabel("基準点の間隔").fill("0.8");
  await a.getByRole("button", { name: "会場の配置を共有に保存" }).click();
  await settle(a);
  await wait(
    b,
    () => JSON.parse(window.render_game_to_text()).vr.calibration === "lost",
  );
  await wait(a, () =>
    JSON.parse(window.render_game_to_text()).room.participants.every(
      (p) => p.presence?.calibration !== "aligned",
    ),
  );
  assert.deepEqual((await state(a)).room.state.flights, beforeFrameChange);
  ok(
    "A changed table invalidates confirmation on connected headsets without changing flights",
  );
  await a.setViewportSize({ width: 390, height: 844 });
  await a.screenshot({ path: `${out}/04-mobile-map.png` });
  assert(
    await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/results.json`,
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(`${checks.length} spatial checks passed`);
} catch (error) {
  for (const [i, context] of browser.contexts().entries()) {
    const p = context.pages()[0];
    if (!p) continue;
    await p.screenshot({ path: `${out}/failure-${i}.png` }).catch(() => {});
    await fs.writeFile(
      `${out}/failure-${i}.json`,
      JSON.stringify(await state(p).catch(() => null), null, 2),
    );
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  rawSocket?.close();
  await browser.close();
}
