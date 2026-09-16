import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

const base = process.env.SHARED_URL || "http://127.0.0.1:8787/";
const out = process.env.SHARED_OUTPUT || "output/shared";
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
const record = (name) => {
  checks.push(name);
  console.log(`OK ${name}`);
};
const state = (page) =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
const wait = (page, predicate, arg) =>
  page.waitForFunction(predicate, arg, { timeout: 25000 });
const ready = (page) =>
  wait(
    page,
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).room.status === "connected",
  );
const revision = (page, n) =>
  wait(
    page,
    (n) => {
      const s = JSON.parse(window.render_game_to_text());
      return s.room.state.revision >= n && !s.room.pending;
    },
    n,
  );
let rawSocket;
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
  for (const page of [a, b])
    page.on("pageerror", (error) => errors.push(error.message));
  await a.goto(new URL("?shared=1", base).href);
  await a
    .getByRole("button", { name: "共有する部屋をつくる", exact: true })
    .click();
  await ready(a);
  const invite = a.url();
  await fs.writeFile(`${out}/invite.json`, JSON.stringify({ invite })); // Ignored output; expires in 1 hour.
  await b.goto(invite);
  await ready(b);
  await wait(
    a,
    () => JSON.parse(window.render_game_to_text()).room.peers === 2,
  );
  assert.deepEqual((await state(a)).room.state, (await state(b)).room.state);
  record("Two independent browser contexts join the same persisted room");

  await a.getByLabel("共有高度を上げる").click();
  await revision(b, 1);
  assert.equal((await state(b)).room.state.draft.route.altitudeM, 260);
  await a.getByLabel("共有する機体").selectOption("1");
  await revision(b, 2);
  await a.getByLabel("共有する航路").selectOption("3");
  await revision(b, 3);
  await a.locator(".room-invite summary").click();
  await a.getByAltText("共有する部屋の招待QR").waitFor();
  assert.equal(await a.getByLabel("部屋の招待URL").inputValue(), invite);
  // Decode the actual rendered QR, including the fragment key, without printing it.
  await a.addScriptTag({ path: "node_modules/jsqr/dist/jsQR.js" });
  assert.equal(
    await a.evaluate(() => {
      const image = document.querySelector(".room-invite img"),
        canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      return jsQR(
        ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width,
        canvas.height,
      )?.data;
    }),
    invite,
  );
  record(
    "PC changes reach the receiver; actual QR decodes to the room invitation",
  );

  await b.locator("#vr-enter").click();
  await wait(b, () => JSON.parse(window.render_game_to_text()).vr.frames > 10);
  const frames = async (count = 3) => {
    const target = (await state(b)).vr.frames + count;
    await wait(
      b,
      (n) => JSON.parse(window.render_game_to_text()).vr.frames >= n,
      target,
    );
  };
  const button = async (column, row) => {
    const { panel, origin } = (await state(b)).vr;
    const x = (30 + column * 497 + 230) / 1024 - 0.5,
      y = 0.5 - (157 + row * 81 + 34) / 512,
      m = panel.matrix;
    const px = x * panel.width,
      py = y * panel.height;
    const target = [
      m[0] * px + m[4] * py + m[12],
      m[1] * px + m[5] * py + m[13],
      m[2] * px + m[6] * py + m[14],
    ];
    await b.evaluate(
      ({ target, origin }) => {
        const c = xrDevice.controllers.right;
        c.position.set(0.25, 1.3, -0.2);
        const d = target.map((n, i) => n - origin[i] - [0.25, 1.3, -0.2][i]),
          len = Math.hypot(...d),
          [x, y, z] = d.map((n) => n / len),
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
  assert.equal((await state(b)).vr.views, 2);
  await button(0, 1); // Edit page.
  await wait(b, () =>
    JSON.parse(window.render_game_to_text()).vr.sharedPage.includes("次の機体"),
  );
  const before = (await state(a)).room.state;
  await button(1, 1); // Altitude +20.
  await revision(a, before.revision + 1);
  assert.equal(
    (await state(a)).room.state.draft.route.altitudeM,
    before.draft.route.altitudeM + 20,
  );
  await button(1, 2);
  await revision(a, before.revision + 2); // Speed +5.
  assert.equal(
    (await state(a)).room.state.draft.flight.speedMps,
    Math.min(75, before.draft.flight.speedMps + 5),
  );
  await button(1, 3); // Points.
  const beforePoint = (await state(a)).room.state;
  await button(1, 1);
  await revision(a, beforePoint.revision + 1);
  assert.equal(
    (await state(a)).room.state.draft.route.a.x,
    beforePoint.draft.route.a.x + 100,
  );
  await b.screenshot({ path: `${out}/02-vr-points.png` });
  record(
    "Quest 3 emulation edits altitude, speed and an anchor through actual controller rays",
  );
  await button(0, 3); // Main.
  await button(0, 0); // Launch in VR.
  await wait(
    a,
    () =>
      JSON.parse(window.render_game_to_text()).room.state.flights.length === 1,
  );
  await wait(
    a,
    () => JSON.parse(window.render_game_to_text()).elapsedMs > 3000,
  );
  const first = structuredClone((await state(a)).room.state.flights[0]);
  assert.deepEqual(first, (await state(b)).room.state.flights[0]);
  // Both positions should represent the same absolute flight time (sampling is sequential).
  const sa = await state(a),
    sb = await state(b);
  const distance = Math.hypot(
    sa.aircraft.position.x - sb.aircraft.position.x,
    sa.aircraft.position.y - sb.aircraft.position.y,
    sa.aircraft.position.z - sb.aircraft.position.z,
  );
  assert(distance < 40, `Position sample difference ${distance.toFixed(1)} m`);
  record(
    "VR launches one common flight with identical start time and route checksum",
  );
  await wait(
    b,
    () => JSON.parse(window.render_game_to_text()).audio.played > 0,
  );
  await a.getByRole("button", { name: "機体情報", exact: true }).click();
  await a.getByRole("button", { name: "機体の方を向く", exact: true }).click();
  assert.equal((await state(a)).inspection.id, "ST-01");
  await a.screenshot({ path: `${out}/00-shared-flight.png`, fullPage: true });
  await a
    .getByRole("button", { name: "機体情報を閉じる", exact: true })
    .click();
  record(
    "The shared flight emits spatial audio; PC aircraft information and look direction remain available",
  );

  await a.getByLabel("共有高度を上げる").click();
  await revision(b, (await state(a)).room.state.revision);
  assert.deepEqual((await state(b)).room.state.flights[0], first);
  await a.locator("#shared-launch").click();
  await wait(
    b,
    () =>
      JSON.parse(window.render_game_to_text()).room.state.flights.length === 2,
  );
  const flights = (await state(b)).room.state.flights;
  assert(flights[1].startsAt >= first.clearAt);
  await a
    .getByRole("button", { name: "次の便を取り消す", exact: true })
    .click();
  await wait(
    b,
    () =>
      JSON.parse(window.render_game_to_text()).room.state.flights.length === 1,
  );
  record(
    "Editing leaves the active flight intact; the next flight queues after its sound tail and can be cancelled",
  );

  // Pause only one endpoint. The remote continues at server time.
  const beforeRest = await state(b);
  if (!beforeRest.resting) await button(1, 0);
  await wait(b, () => JSON.parse(window.render_game_to_text()).resting);
  await wait(
    a,
    (n) => JSON.parse(window.render_game_to_text()).elapsedMs > n + 1000,
    beforeRest.elapsedMs,
  );
  assert.equal((await state(a)).paused, false);
  const beforeReload = (await state(a)).elapsedMs;
  await a.reload();
  await ready(a);
  await wait(
    a,
    (n) => JSON.parse(window.render_game_to_text()).elapsedMs >= n,
    beforeReload,
  );
  assert.equal((await state(a)).audio.played, 0);
  record(
    "Local rest does not pause peers; reload rejoins the current flight without an old audio burst",
  );

  // Inspect the real WebSocket authority (no test-only server endpoints).
  const u = new URL(invite),
    room = u.searchParams.get("room"),
    key = new URLSearchParams(u.hash.slice(1)).get("key");
  const socketUrl = new URL(`/api/rooms/${room}/connect`, base);
  socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
  const messages = [];
  rawSocket = new WebSocket(socketUrl, ["airplanevoice-room-v1", `key.${key}`]);
  rawSocket.addEventListener("message", (e) =>
    messages.push(JSON.parse(e.data)),
  );
  const received = async (predicate) => {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      const i = messages.findIndex(predicate);
      if (i >= 0) return messages.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("WebSocket message timeout");
  };
  let current = (await received((m) => m.type === "state")).state;
  const id = randomUUID();
  rawSocket.send(
    JSON.stringify({
      type: "edit",
      id,
      revision: current.revision,
      recipe: current.draft,
    }),
  );
  const accepted = await received((m) => m.ack === id);
  rawSocket.send(
    JSON.stringify({
      type: "edit",
      id,
      revision: current.revision,
      recipe: current.draft,
    }),
  );
  assert.equal(
    (await received((m) => m.ack === id)).state.revision,
    accepted.state.revision,
  );
  const stale = randomUUID();
  rawSocket.send(
    JSON.stringify({
      type: "edit",
      id: stale,
      revision: current.revision,
      recipe: current.draft,
    }),
  );
  assert.equal((await received((m) => m.id === stale)).type, "rejected");
  const invalid = randomUUID();
  rawSocket.send(
    JSON.stringify({
      type: "edit",
      id: invalid,
      revision: accepted.state.revision,
      recipe: {},
    }),
  );
  assert.equal((await received((m) => m.id === invalid)).type, "rejected");
  rawSocket.close();
  rawSocket = null;
  const denied = await fetch(new URL(`/api/rooms/${room}/connect`, base), {
    headers: {
      "Sec-WebSocket-Protocol": "airplanevoice-room-v1,key." + "0".repeat(64),
    },
  });
  assert.equal(denied.status, 403);
  const otherOrigin = await fetch(new URL("/api/rooms", base), {
    method: "POST",
    headers: { Origin: "https://unrelated.invalid" },
  });
  assert.equal(otherOrigin.status, 403);
  record(
    "Actual authority rejects stale edits, invalid recipes, wrong invitations and other browser origins; duplicate operations apply once",
  );

  // Exercise the browser's connectivity event, including the app's immediate
  // disabled state; the client also detects a silent loss with its heartbeat.
  await pc.setOffline(true);
  await a.evaluate(() => window.dispatchEvent(new Event("offline")));
  await wait(a, () =>
    ["offline", "connecting", "failed"].includes(
      JSON.parse(window.render_game_to_text()).room.status,
    ),
  );
  assert(await a.getByLabel("共有高度を上げる").isDisabled());
  const remote = await state(b);
  await pc.setOffline(false);
  await a.evaluate(() => window.dispatchEvent(new Event("online")));
  await ready(a);
  assert.equal(
    (await state(a)).room.state.revision,
    remote.room.state.revision,
  );
  record(
    "Disconnected controls cannot overwrite the room; reconnection receives the latest authority state",
  );
  await a.screenshot({ path: `${out}/01-shared-desktop.png`, fullPage: true });
  await b.screenshot({ path: `${out}/03-shared-vr.png` });
  await a.setViewportSize({ width: 390, height: 844 });
  await a.screenshot({ path: `${out}/04-shared-mobile.png`, fullPage: true });
  assert(
    await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  record("Mobile layout has no horizontal overflow");
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/results.json`,
    JSON.stringify(
      { checks, errors, positionSampleDifferenceM: distance },
      null,
      2,
    ),
  );
  console.log(`${checks.length} shared checks passed`);
} finally {
  rawSocket?.close();
  await browser.close();
}
