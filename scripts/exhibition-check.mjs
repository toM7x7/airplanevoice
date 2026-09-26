import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

const base = process.env.SHARED_URL || "http://127.0.0.1:8787/";
const out = process.env.EXHIBITION_OUTPUT || "output/exhibition";
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
const state = (page) =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
const wait = (page, fn, arg) =>
  page.waitForFunction(fn, arg, { timeout: 30000 });
const ready = (page) =>
  wait(
    page,
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).room.status === "connected",
  );
let socket;
try {
  const pc = await browser.newContext({
    viewport: { width: 1440, height: 980 },
  });
  const quest = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const emulation = await fs.readFile(
    "node_modules/iwer/build/iwer.min.js",
    "utf8",
  );
  await quest.addInitScript({
    content: `${emulation}\nwindow.xrDevice = new IWER.XRDevice(IWER.metaQuest3, {stereoEnabled:true}); xrDevice.installRuntime({forceInstall:true, polyfillLayers:false}); xrDevice.controlMode='programmatic'; xrDevice.position.set(0,1.65,0);`,
  });
  const a = await pc.newPage(),
    b = await quest.newPage();
  for (const p of [a, b]) p.on("pageerror", (e) => errors.push(e.message));
  await a.goto(new URL("?shared=1", base).href);
  await a
    .getByRole("button", { name: "展示用の部屋をつくる（8時間）" })
    .click();
  await ready(a);
  const initial = await state(a);
  assert.equal(initial.room.role, "editor");
  assert(initial.room.state.expiresAt - initial.room.now > 7.9 * 3600000);
  await a.locator(".room-invite summary").click();
  await a.getByAltText("共有する部屋の招待QR").waitFor();
  const invite = await a.getByLabel("部屋の招待URL").inputValue();
  assert.notEqual(new URL(invite).hash, new URL(a.url()).hash);
  assert.equal(new URL(invite).searchParams.get("visit"), "1");
  await a.addScriptTag({ path: "node_modules/jsqr/dist/jsQR.js" });
  const decoded = await a.evaluate(() => {
    const img = document.querySelector(".room-invite img"),
      canvas = document.createElement("canvas");
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
  assert.equal(decoded, invite);
  // Private capabilities only in ignored output, never console output.
  await fs.writeFile(
    `${out}/invite.json`,
    JSON.stringify({ invite, operator: a.url() }),
  );
  ok(
    "Eight-hour exhibition issues a distinct visitor QR that decodes correctly",
  );
  await a.locator("#exhibition-repeat").click();
  await wait(
    a,
    () =>
      JSON.parse(window.render_game_to_text()).room.state.exhibition.repeat &&
      !JSON.parse(window.render_game_to_text()).room.pending,
  );
  await wait(
    a,
    () => JSON.parse(window.render_game_to_text()).elapsedMs > 1000,
  );
  const flight = (await state(a)).room.state.flights[0];
  await b.goto(invite);
  await ready(b);
  assert.equal((await state(b)).room.role, "viewer");
  assert.equal(await b.getByLabel("共有する機体").count(), 0);
  assert.equal(await b.locator("#shared-launch").count(), 0);
  assert.deepEqual((await state(b)).room.state.flights[0], flight);
  await b.screenshot({ path: `${out}/01-visitor.png` });
  ok(
    "Visitor joins the running flight without editing controls or a flight restart",
  );

  const url = new URL(invite),
    roomId = url.searchParams.get("room");
  const endpoint = new URL(`/api/rooms/${roomId}/connect`, base);
  endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
  const messages = [];
  socket = new WebSocket(endpoint, [
    "airplanevoice-room-v1",
    `key.${new URLSearchParams(url.hash.slice(1)).get("key")}`,
  ]);
  socket.addEventListener("message", (e) => messages.push(JSON.parse(e.data)));
  const receive = async (predicate) => {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      const i = messages.findIndex(predicate);
      if (i >= 0) return messages.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("Timed out waiting for authority response");
  };
  const welcome = await receive((m) => m.type === "state");
  assert.equal(welcome.role, "viewer");
  assert.equal(welcome.state.protocol, "airplanevoice-room-v1");
  const current = welcome.state;
  for (const type of ["edit", "launch", "repeat", "cancel-next"]) {
    const id = randomUUID();
    socket.send(
      JSON.stringify({
        id,
        revision: current.revision,
        type,
        enabled: false,
        recipe: current.draft,
      }),
    );
    const result = await receive((m) => m.id === id);
    assert.equal(result.type, "rejected");
    assert.equal(result.state.revision, current.revision);
  }
  socket.close();
  socket = null;
  ok("Server rejects visitor changes to operator settings through a direct WebSocket");

  await b.locator("#vr-enter").click();
  await wait(b, () => JSON.parse(window.render_game_to_text()).vr.frames > 10);
  let s = await state(b);
  assert.equal(s.vr.sessionMode, "immersive-ar");
  assert.equal(s.vr.displayMode, "vr");
  assert.equal(s.vr.views, 2);
  assert.equal(s.resting, false);
  assert.equal(s.audio.state, "running");
  const frames = async () => {
    const n = (await state(b)).vr.frames + 3;
    await wait(
      b,
      (n) => {
        const vr = JSON.parse(window.render_game_to_text()).vr;
        return vr.status === "ready" || vr.frames >= n;
      },
      n,
    );
  };
  const button = async (column, row) => {
    await wait(b, () => JSON.parse(window.render_game_to_text()).vr.controls.progress === 1);
    const { panel, origin, controls } = (await state(b)).vr,
      m = panel.matrix;
    const hit = controls.targets.filter(t=>t.id.startsWith("action:"))[row*2+column];
    const x = ((hit.x+hit.w/2) / 1024 - 0.5) * panel.width;
    const y = (0.5 - (hit.y+hit.h/2) / 512) * panel.height;
    const target = [
      m[0] * x + m[4] * y + m[12],
      m[1] * x + m[5] * y + m[13],
      m[2] * x + m[6] * y + m[14],
    ];
    await b.evaluate(
      ({ target, origin }) => {
        const c = xrDevice.controllers.right;
        c.position.set(0.25, 1.3, -0.2);
        const d = target.map((n, i) => n - origin[i] - [0.25, 1.3, -0.2][i]);
        const length = Math.hypot(...d),
          [x, y, z] = d.map((n) => n / length),
          norm = Math.hypot(y, -x, 1 - z);
        c.quaternion.set(y / norm, -x / norm, 0, (1 - z) / norm);
      },
      { target, origin },
    );
    await frames();
    await b.evaluate(() =>
      xrDevice.controllers.right.updateButtonValue("trigger", 1),
    );
    await frames();
    await b.evaluate(() =>
      xrDevice.controllers.right.updateButtonValue("trigger", 0),
    );
    await frames();
  };
  await button(0, 3); // View/help.
  await b.screenshot({ path: `${out}/02-vr-guide.png` });
  const before = await state(b);
  await button(0, 0); // AR.
  s = await state(b);
  assert.equal(s.vr.displayMode, "ar");
  assert.equal(s.vr.sessionMode, "immersive-ar");
  assert.equal(s.playbackId, before.playbackId);
  assert.equal(s.room.state.revision, before.room.state.revision);
  assert(s.vr.frames > before.vr.frames);
  assert(s.elapsedMs > before.elapsedMs);
  assert.deepEqual(s.vr.origin, before.vr.origin);
  assert.equal(s.resting, false);
  await b.screenshot({ path: `${out}/03-ar-guide.png` });
  await button(1, 0); // Hide.
  assert.equal((await state(b)).vr.panelVisible, false);
  await b.screenshot({ path: `${out}/04-ar-aircraft-only.png` });
  await b.evaluate(() =>
    xrDevice.controllers.right.updateButtonValue("squeeze", 1),
  );
  await frames();
  await b.evaluate(() =>
    xrDevice.controllers.right.updateButtonValue("squeeze", 0),
  );
  await frames();
  assert.equal((await state(b)).vr.panelVisible, true);
  await button(0, 0); // Back to virtual sky.
  assert.equal((await state(b)).vr.displayMode, "vr");
  ok(
    "Single gesture unlocks audio; controller switches AR and virtual sky without resetting the flight, frame, clock or room",
  );
  ok("Operation panel hides for observation and the grip recalls it");

  await button(0, 3); // Exit.
  await wait(
    b,
    () => JSON.parse(window.render_game_to_text()).vr.status === "ready",
  );
  assert.equal((await state(b)).vr.displayMode, "vr");
  const beforeReentry = (await state(a)).room.state.flights[0];
  if (beforeReentry.id !== flight.id) {
    assert(beforeReentry.startsAt >= flight.clearAt);
    ok("Actual server alarm advanced the exhibition to another flight");
  }
  const noFlag = new URL(invite);
  noFlag.searchParams.delete("visit");
  await b.goto(noFlag.href);
  await ready(b);
  assert.equal((await state(b)).room.role, "viewer");
  assert.equal(await b.getByLabel("共有する機体").count(), 0);
  assert.deepEqual((await state(b)).room.state.flights[0], beforeReentry);
  ok(
    "Re-entry retains viewer authority even with the visitor URL flag removed",
  );

  await a.reload();
  await ready(a);
  await a.locator(".room-invite summary").click();
  await a.getByAltText("共有する部屋の招待QR").waitFor();
  assert.equal(await a.getByLabel("部屋の招待URL").inputValue(), invite);
  const beforeStop = (await state(a)).room.state.flights[0];
  await a.locator("#exhibition-repeat").click();
  await wait(
    b,
    () =>
      !JSON.parse(window.render_game_to_text()).room.state.exhibition.repeat,
  );
  assert.deepEqual((await state(b)).room.state.flights[0], beforeStop);
  ok(
    "Operator reload keeps the same visitor QR; stopping repetition preserves the current flight",
  );
  await b.evaluate(() => {
    const original = navigator.xr.requestSession.bind(navigator.xr);
    navigator.xr.requestSession = (mode, options) =>
      mode === "immersive-ar"
        ? Promise.reject(
            new DOMException("AR denied for fallback test", "NotAllowedError"),
          )
        : original(mode, options);
  });
  await b.locator("#vr-enter").click();
  await b.getByRole("button", { name: "ARを使わずVRで開く" }).click();
  await wait(b, () => JSON.parse(window.render_game_to_text()).vr.frames > 10);
  assert.equal((await state(b)).vr.sessionMode, "immersive-vr");
  assert.equal((await state(b)).vr.canShowAR, false);
  assert.equal((await state(b)).audio.state, "running");
  await button(0, 3); // View/help.
  await button(0, 3); // Exit from view/help.
  await wait(
    b,
    () => JSON.parse(window.render_game_to_text()).vr.status === "ready",
  );
  ok("Declined AR permission offers a separate working VR entry");
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/results.json`,
    JSON.stringify({ checks, errors }, null, 2),
  );
} finally {
  socket?.close();
  await browser.close();
}
