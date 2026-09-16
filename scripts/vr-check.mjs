import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

// IWER is injected by the test only. It is never imported by the shipped app.
const url = process.env.TEST_URL || "http://127.0.0.1:5173/";
const out = process.env.VR_OUTPUT || "output/vr";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const errors = [];
const checks = [];
const record = (name) => {
  checks.push(name);
  console.log(`OK ${name}`);
};
const emulation = await fs.readFile(
  "node_modules/iwer/build/iwer.min.js",
  "utf8",
);
let context;
try {
  context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  });
  let page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).vr.status === "unsupported",
  );
  assert(await page.locator("#vr-enter").isDisabled());
  assert(await page.locator("#start-btn").isEnabled());
  await page.screenshot({ path: `${out}/01-desktop.png` });
  record("Unsupported browser retains PC flight controls");
  await context.close();

  context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  });
  await context.addInitScript({
    content: `${emulation}\nwindow.xrDevice = new IWER.XRDevice(IWER.metaQuest3, {stereoEnabled: true});
    xrDevice.installRuntime({forceInstall:true, polyfillLayers:false});
    xrDevice.controlMode = 'programmatic';
    xrDevice.position.set(0, 1.65, 0);`,
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const state = () =>
    page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const wait = (predicate, arg, timeout = 15000) =>
    page.waitForFunction(predicate, arg, { timeout });
  const frames = async (count = 2) => {
    const target = (await state()).vr.frames + count;
    await wait((target) => {
      const { vr } = JSON.parse(window.render_game_to_text());
      return vr.status !== "presenting" || vr.frames >= target;
    }, target);
  };
  const press = async (id = "trigger") => {
    await page.evaluate(
      (id) => xrDevice.controllers.right.updateButtonValue(id, 1),
      id,
    );
    await frames();
    await page.evaluate(
      (id) => xrDevice.controllers.right.updateButtonValue(id, 0),
      id,
    );
    await frames();
  };
  const aim = async (world, flightId = null) => {
    await page.evaluate(
      ({ world, flightId }) => {
        window.stopVrAim?.();
        let tracking = true;
        window.stopVrAim = () => {
          tracking = false;
        };
        const update = () => {
          if (!tracking) return;
          const s = JSON.parse(window.render_game_to_text());
          const p =
            flightId && s.fleet.find((f) => f.id === flightId).pose.position;
          const target = p ? [p.x, p.y, p.z] : world;
          const c = xrDevice.controllers.right;
          // Raise the pointing hand above the menu when targeting a plane.
          // A ray from y=1.3 can intersect the menu's top edge before the aircraft.
          const hand = [0.25, flightId ? 1.8 : 1.3, -0.2];
          c.position.set(...hand);
          const d = target.map((n, i) => n - s.vr.origin[i] - hand[i]);
          const length = Math.hypot(...d),
            [x, y, z] = d.map((n) => n / length);
          const norm = Math.hypot(y, -x, 1 - z);
          c.quaternion.set(y / norm, -x / norm, 0, (1 - z) / norm);
          // Follow the moving target while slow software-rendered frames process input.
          if (flightId) xrDevice.activeSession.requestAnimationFrame(update);
        };
        update();
      },
      { world, flightId },
    );
    await frames();
  };
  const button = async (x, y) => {
    const { panel } = (await state()).vr;
    const px = (x / 1024 - 0.5) * panel.width,
      py = (0.5 - y / 512) * panel.height,
      m = panel.matrix;
    await aim([
      m[0] * px + m[4] * py + m[12],
      m[1] * px + m[5] * py + m[13],
      m[2] * px + m[6] * py + m[14],
    ]);
    await press();
  };
  await page.goto(url);
  await wait(
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).vr.status === "ready",
  );
  await page.evaluate(() => {
    window.originalRequest = navigator.xr.requestSession.bind(navigator.xr);
    navigator.xr.requestSession = () =>
      Promise.reject(new DOMException("Test denial", "NotAllowedError"));
  });
  await page.locator("#vr-enter").click();
  await wait(() =>
    JSON.parse(window.render_game_to_text()).vr.error.includes("許可"),
  );
  assert.equal((await state()).phase, "EDIT");
  await page.evaluate(() => {
    navigator.xr.requestSession = window.originalRequest;
  });
  record("Denied entry is recoverable and preserves editing");

  await page.evaluate(() => {
    navigator.xr.requestSession = async (...args) => {
      const session = await window.originalRequest(...args);
      session.requestReferenceSpace = () =>
        Promise.reject(
          new DOMException("Test floor failure", "NotSupportedError"),
        );
      return session;
    };
  });
  await page.locator("#vr-enter").click();
  await wait(() =>
    JSON.parse(window.render_game_to_text()).vr.error.includes("床設定"),
  );
  assert.equal((await state()).phase, "EDIT");
  assert.deepEqual((await state()).listener, { x: 0, y: 1.7, z: 0 });
  await page.evaluate(() => {
    navigator.xr.requestSession = window.originalRequest;
  });
  record("Failure after session creation cleans up and allows retry");

  await page.locator("#vr-enter").click();
  await wait(() => JSON.parse(window.render_game_to_text()).vr.frames > 12);
  let s = await state();
  assert.equal(s.vr.status, "presenting");
  assert.equal(s.vr.views, 2);
  assert.equal(s.vr.inputSources, 2);
  assert(Math.abs(s.listener.y - 1.65) < 0.01);
  assert(s.vr.tracked);
  await page.screenshot({ path: `${out}/02-stereo-entry.png` });
  record("Quest 3 emulation renders two eyes, floor height and controllers");

  await page.evaluate(() => {
    xrDevice.position.set(0.35, 1.2, -0.4);
    xrDevice.quaternion.set(0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4));
  });
  await wait(() => JSON.parse(window.render_game_to_text()).listener.x > 0.34);
  s = await state();
  assert(Math.abs(s.listener.y - 1.2) < 0.01);
  assert(Math.abs(s.listener.z + 0.4) < 0.01);
  s.vr.head.position.forEach((n, i) =>
    assert(Math.abs(n - s.audio.listener.position[i]) < 0.001),
  );
  s.vr.head.forward.forEach((n, i) =>
    assert(Math.abs(n - s.audio.listener.forward[i]) < 0.001),
  );
  assert(s.audio.listener.forward[0] < -0.99);
  assert(Math.abs(s.audio.listener.forward[2]) < 0.01);
  record(
    "Centre head translation and 90-degree turn reach real AudioListener parameters",
  );

  await press("squeeze");
  s = await state();
  assert(s.vr.panel.matrix[12] < -2);
  record("Grip recalls a world-anchored panel in the new viewing direction");
  // Return forward for readable screenshots and deterministic pointing.
  await page.evaluate(() => {
    xrDevice.position.set(0, 1.65, 0);
    xrDevice.quaternion.set(0, 0, 0, 1);
  });
  await press("squeeze");
  await button(240, 350);
  assert.equal((await state()).inspection.id, "ST-01");
  record("Spatial aircraft button opens speed and heading information");
  await button(800, 100);
  assert.equal((await state()).inspection.id, "ST-01");
  await aim([3000, 2000, 1000]);
  await press();
  s = await state();
  assert.equal(s.inspection, null);
  assert.equal(s.vr.selected, null);
  assert.equal(s.vr.selectionMarkerVisible, false);
  assert.equal(s.mixMode, "balanced");
  assert.equal(s.phase, "EDIT");
  record(
    "Empty sky trigger clears selection and restores all-plane listening; panel gaps preserve selection",
  );
  await button(240, 350);
  await button(250, 243);
  await wait(() => JSON.parse(window.render_game_to_text()).phase !== "EDIT");
  await wait(
    () => JSON.parse(window.render_game_to_text()).audio.played > 0,
    undefined,
    45000,
  );
  s = await state();
  assert.equal(s.audio.state, "running");
  assert.equal(s.phase, "FLY");
  assert(s.audio.activeVoices <= 6);
  await page.screenshot({ path: `${out}/03-stereo-flight.png` });
  record("Trigger starts flight and delayed spatial audio in real time");
  await button(250, 243);
  s = await state();
  assert.equal(s.paused, true);
  const stopped = s.elapsedMs;
  assert.equal(s.audio.activeVoices, 0);
  await page.waitForTimeout(400);
  assert.equal((await state()).elapsedMs, stopped);
  await button(250, 243);
  await wait(() => !JSON.parse(window.render_game_to_text()).paused);
  record("Spatial pause drains voices and freezes time; resume continues");

  await aim(null, "ST-01");
  await press();
  assert.equal((await state()).vr.selected, "ST-01");
  await button(750, 243);
  assert.equal((await state()).audio.muted, true);
  await button(750, 243);
  assert.equal((await state()).audio.muted, false);
  record(
    "Aircraft ray selection and sound toggle remain separate from flight control",
  );

  await page.evaluate(() => xrDevice.updateVisibilityState("visible-blurred"));
  await wait(() => JSON.parse(window.render_game_to_text()).paused);
  assert.equal((await state()).audio.activeVoices, 0);
  await page.evaluate(() => xrDevice.updateVisibilityState("visible"));
  await page.waitForTimeout(300);
  assert.equal((await state()).paused, true);
  await button(250, 243);
  assert.equal((await state()).paused, false);
  await page.evaluate(() => xrDevice.updateVisibilityState("hidden"));
  await wait(() => JSON.parse(window.render_game_to_text()).paused);
  await page.evaluate(() => xrDevice.updateVisibilityState("visible"));
  await page.waitForTimeout(300);
  assert.equal((await state()).paused, true);
  record("Blurred and hidden sessions pause without automatic resumption");
  await button(850, 453);
  await wait(
    () => JSON.parse(window.render_game_to_text()).vr.status === "ready",
  );
  s = await state();
  assert.deepEqual(s.listener, { x: 0, y: 1.7, z: 0 });
  assert(s.paused);
  assert.equal(s.audio.activeVoices, 0);
  await page.screenshot({ path: `${out}/04-return-to-page.png` });
  const geometries = s.render.geometries;
  record(
    "Spatial exit restores the PC observer and leaves flight safely paused",
  );
  await page.locator("#vr-enter").click();
  await wait(() => JSON.parse(window.render_game_to_text()).vr.frames > 12);
  assert.equal((await state()).vr.views, 2);
  await page.evaluate(() => xrDevice.activeSession.end());
  await wait(
    () => JSON.parse(window.render_game_to_text()).vr.status === "ready",
  );
  await page.waitForTimeout(250);
  s = await state();
  assert(s.render.geometries <= geometries + 1);
  record("Re-entry and system exit clean up XR geometry without growth");
  await page
    .getByRole("button", { name: "航路を描き直す", exact: true })
    .click();
  await page.getByRole("button", { name: "3機", exact: true }).click();
  await page.getByRole("button", { name: "丘の上", exact: true }).click();
  await page
    .getByRole("checkbox", {
      name: "周回ごとに変化して飛び続ける",
      exact: true,
    })
    .check();
  const hill = (await state()).listener;
  await page.locator("#vr-enter").click();
  await wait(() => JSON.parse(window.render_game_to_text()).vr.frames > 12);
  s = await state();
  assert(Math.abs(s.listener.x - hill.x) < 0.01);
  assert(Math.abs(s.listener.y - (hill.y - 1.7 + 1.65)) < 0.01);
  await button(250, 243);
  await wait(
    () =>
      JSON.parse(window.render_game_to_text()).audio.playedByFlight["ST-03"] >
      0,
    undefined,
    60000,
  );
  await button(500, 350);
  assert.equal((await state()).inspection.id, "ST-02");
  await aim(null, "ST-01");
  await press();
  assert.equal((await state()).inspection.id, "ST-01");
  s = await state();
  assert.equal(s.vr.views, 2);
  assert(s.audio.activeVoices <= 18);
  const routeBeforeSound = s.checksum;
  await button(830, 350);
  assert.equal((await state()).inspection.id, "ST-03");
  await button(170, 452);
  assert.equal((await state()).vr.audioPage, true);
  await button(250, 243);
  assert.equal((await state()).mixMode, "balanced");
  await wait(() => {
    const s = JSON.parse(window.render_game_to_text());
    return (
      s.fleet.every(
        (f) => (s.audio.levels.flights[f.id]?.rms ?? 0) > 0.00001,
      ) && s.audio.levels.output.rms > 0.00001
    );
  });
  record(
    "All three planes and final output contain simultaneous stereo waveforms inside VR",
  );
  await button(850, 345);
  assert.equal((await state()).audio.volume, 40);
  await button(620, 345);
  assert.equal((await state()).audio.volume, 35);
  await button(250, 345);
  assert.equal((await state()).audio.outputProfile, "headphones");
  await button(250, 345);
  assert.equal((await state()).audio.outputProfile, "speaker");
  await button(750, 243);
  assert.equal((await state()).mixMode, "focus");
  assert.equal((await state()).focusId, "ST-03");
  await button(250, 243);
  assert.equal((await state()).mixMode, "balanced");
  assert.equal((await state()).checksum, routeBeforeSound);
  await page.screenshot({ path: `${out}/06-vr-sound-settings.png` });
  await button(750, 243);
  assert.equal((await state()).focusId, "ST-03");
  const beforeClear = await state();
  await button(500, 453);
  s = await state();
  assert.equal(s.inspection, null);
  assert.equal(s.vr.selected, null);
  assert.equal(s.vr.selectionMarkerVisible, false);
  assert.equal(s.mixMode, "balanced");
  assert.equal(s.checksum, beforeClear.checksum);
  assert(s.elapsedMs >= beforeClear.elapsedMs);
  assert.equal(s.paused, false);
  await button(750, 243);
  assert.equal((await state()).mixMode, "balanced");
  await page.screenshot({ path: `${out}/07-cleared-sound-settings.png` });
  record(
    "Clear selection removes information and marker, restores all-plane sound and disables stale focus",
  );
  await button(150, 453);
  assert.equal((await state()).vr.audioPage, false);
  record(
    "VR sound page changes volume, speaker profile and listening mix without changing flight",
  );
  await page.screenshot({ path: `${out}/05-three-aircraft.png` });
  record(
    "Three aircraft sound independently; ray switches selection; hill origin remains in metres",
  );
  await button(500, 350);
  assert.equal((await state()).inspection.id, "ST-02");
  await button(250, 243);
  const pausedBeforeClear = await state();
  assert(pausedBeforeClear.paused);
  await button(500, 453);
  s = await state();
  assert.equal(s.inspection, null);
  assert.equal(s.vr.selectionMarkerVisible, false);
  assert.equal(s.elapsedMs, pausedBeforeClear.elapsedMs);
  assert.equal(s.checksum, pausedBeforeClear.checksum);
  assert.equal(s.mixMode, "balanced");
  assert(s.paused);
  await page.screenshot({ path: `${out}/08-cleared-main-panel.png` });
  await button(250, 243);
  record(
    "Main-panel clear also works after re-selection and preserves paused flight",
  );
  if (await page.evaluate(() => typeof window.advanceTime === "function")) {
    const beforeLap = s.lap;
    await page.evaluate(
      (ms) => window.advanceTime(ms),
      s.durationMs * 2 + 50000,
    );
    s = await state();
    assert(s.lap > beforeLap);
    assert.equal(s.vr.status, "presenting");
    assert.equal(s.vr.views, 2);
    record(
      "Accelerated multi-lap evolution preserves the active stereo session",
    );
  }
  await page.evaluate(() => xrDevice.activeSession.end());
  await wait(
    () => JSON.parse(window.render_game_to_text()).vr.status === "ready",
  );
  assert.deepEqual((await state()).listener, hill);
  record("Non-default observer returns unchanged after VR");
  // Fresh page removes development time stepping before a real-time authored show.
  await page.reload();
  await page.getByRole("button", { name: "リセット", exact: true }).click();
  await page
    .getByRole("button", { name: "演目をつくる →", exact: true })
    .click();
  await page.getByRole("button", { name: "三つの高さ", exact: true }).click();
  for (const id of ["ST-02", "ST-03"]) {
    await page
      .getByRole("button", { name: `${id}を編集`, exact: true })
      .click();
    await page
      .getByRole("slider", { name: `${id}の開始時刻`, exact: true })
      .fill("0");
  }
  const authored = (await state()).show;
  await page.locator("#vr-enter").click();
  await wait(() => JSON.parse(window.render_game_to_text()).vr.views === 2);
  await button(750, 350);
  assert.equal((await state()).inspection.id, "ST-03");
  assert.equal(
    (await state()).inspection.speedMps,
    authored.flights[2].recipe.flight.speedMps,
  );
  record(
    "Authored aircraft previews remain selectable with their own speed in stereo XR",
  );
  await button(250, 243);
  await wait(
    () => {
      const s = JSON.parse(window.render_game_to_text());
      return (
        s.fleet.length === 3 &&
        s.fleet.every((f) => f.state === "flying") &&
        ["ST-01", "ST-02", "ST-03"].every(
          (id) => s.audio.playedByFlight[id] > 2,
        )
      );
    },
    undefined,
    45000,
  );
  s = await state();
  assert.equal(s.vr.views, 2);
  assert(new Set(s.fleet.map((f) => Math.round(f.pose.position.y))).size === 3);
  assert.deepEqual(s.show, authored);
  await aim(null, "ST-03");
  await press();
  assert.equal((await state()).inspection.id, "ST-03");
  await page.screenshot({ path: `${out}/09-authored-show.png` });
  record(
    "Three independent routes and mixed two/four-engine aircraft start and emit audio in XR",
  );
  await page.evaluate(() => xrDevice.activeSession.end());
  await wait(
    () => JSON.parse(window.render_game_to_text()).vr.status === "ready",
  );
  assert((await state()).paused);
  assert.deepEqual((await state()).show, authored);
  record("Leaving XR preserves the authored show and pauses its local clock");
  s = await state();
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/results.json`,
    JSON.stringify(
      {
        url,
        emulator: "IWER 2.4.0 / Meta Quest 3, not physical hardware",
        checks,
        errors,
        final: s,
      },
      null,
      2,
    ),
  );
  console.log(
    `${checks.length} VR scenarios passed. Physical Quest comfort and performance remain unverified.`,
  );
} catch (error) {
  const pages = context?.pages() ?? [];
  for (const [i, page] of pages.entries()) {
    await page.screenshot({ path: `${out}/failure-${i}.png` }).catch(() => {});
    await fs.writeFile(
      `${out}/failure-${i}.json`,
      JSON.stringify(
        await page
          .evaluate(() => JSON.parse(window.render_game_to_text()))
          .catch(() => ({})),
        null,
        2,
      ),
    );
  }
  throw error;
} finally {
  await browser.close();
}
