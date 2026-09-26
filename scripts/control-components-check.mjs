import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const base = process.env.TEST_URL || "http://127.0.0.1:5173/";
const url = new URL("?ui=components", base).href;
const out = process.env.CONTROL_OUTPUT || "output/control-components";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const errors = [],
  checks = [];
const ok = (name) => {
  checks.push(name);
  console.log(`OK ${name}`);
};
const state = (page) =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
const ready = (page) =>
  page.waitForFunction(
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).mode ===
        "control-components-preview",
  );
const action = (page, id) =>
  page.locator(`[data-action="${id}"]`).filter({ visible: true }).first();
try {
  const pc = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await pc.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const apiRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api"))
      apiRequests.push(request.url());
  });
  await page.goto(url);
  await ready(page);
  await page.evaluate(() =>
    localStorage.setItem("sound-trail.desktop.route.v1", "preserve-me"),
  );
  assert.equal((await state(page)).controls.open, false);
  assert.equal(await page.locator("canvas").count(), 1);
  assert(await page.locator("#lab-enter").isDisabled());
  await action(page, "menu.toggle").click();
  await page.locator('#av-control-panel[data-open="true"]').waitFor();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("#av-control-panel")).opacity ===
      "1",
  );
  await page.screenshot({ path: `${out}/01-pc-menu.png` });
  await page.keyboard.press("Escape");
  assert.equal((await state(page)).controls.open, false);
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("data-action"),
    ),
    "menu.toggle",
  );
  assert.equal(
    await page.locator("#av-control-panel").evaluate((el) => el.inert),
    true,
  );
  await page.keyboard.press("Enter");
  await action(page, "menu.view").click();
  assert(await action(page, "view.environment").isDisabled());
  await action(page, "menu.home").click();
  await action(page, "menu.sound").click();
  await action(page, "sound.louder").click();
  assert.equal((await state(page)).audio.volume, 40);
  await page.locator('.av-control-bar [data-action="sound.toggle"]').click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).audio.on,
  );
  await page.locator('.av-control-bar [data-action="sound.toggle"]').click();
  assert.equal((await state(page)).audio.on, false);
  ok(
    "DOM actions, disabled AR, sound/volume, Escape focus return and inert closed menu",
  );
  await action(page, "menu.home").click();
  await action(page, "flight.start").click();
  const before = await state(page);
  assert.equal(before.controls.open, false);
  await action(page, "menu.toggle").click();
  await page.waitForFunction(
    (t) => JSON.parse(window.render_game_to_text()).elapsedMs > t + 100,
    before.elapsedMs,
  );
  assert.equal((await state(page)).lap, before.lap);
  await page.evaluate(() => {
    const b = document.querySelector('[data-action="menu.toggle"]');
    for (let i = 0; i < 7; i++) b.click();
  });
  assert.equal((await state(page)).controls.open, false);
  await action(page, "menu.toggle").click();
  await page.locator("canvas").click({ position: { x: 25, y: 210 } });
  assert.equal((await state(page)).controls.open, false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await action(page, "menu.toggle").click();
  assert.equal((await state(page)).controls.reduced, true);
  assert.equal(
    await page
      .locator("#av-control-panel")
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  await action(page, "menu.help").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/02-mobile-help.png` });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("sound-trail.desktop.route.v1"),
    ),
    "preserve-me",
  );
  assert.equal(apiRequests.length, 0);
  ok(
    "Flight continues during menus; rapid toggle, outside close, reduced motion, mobile and storage/room isolation",
  );
  await pc.close();

  const emulation = await fs.readFile(
    "node_modules/iwer/build/iwer.min.js",
    "utf8",
  );
  for (const model of ["metaQuest3", "metaQuest2"]) {
    const context = await browser.newContext({
      viewport: { width: 960, height: 640 },
    });
    await context.addInitScript({
      content: `${emulation}\nwindow.xrDevice = new IWER.XRDevice(IWER.${model}, {stereoEnabled:true}); xrDevice.installRuntime({forceInstall:true, polyfillLayers:false}); xrDevice.controlMode='programmatic'; xrDevice.position.set(0,1.65,0);`,
    });
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(url);
    await ready(p);
    await p.waitForFunction(
      () => JSON.parse(window.render_game_to_text()).vr.status === "ready",
    );
    await p.locator("#lab-enter").click();
    const frames = async (count = 3) => {
      const n = (await state(p)).vr.frames + count;
      await p.waitForFunction(
        (n) => {
          const vr = JSON.parse(window.render_game_to_text()).vr;
          return vr.status === "ready" || vr.frames >= n;
        },
        n,
        { timeout: 30000 },
      );
    };
    const press = async (button = "trigger") => {
      await p.evaluate(
        (button) => xrDevice.controllers.right.updateButtonValue(button, 1),
        button,
      );
      await frames();
      await p.evaluate(
        (button) => xrDevice.controllers.right.updateButtonValue(button, 0),
        button,
      );
      await frames();
    };
    const aim = async (px, py) => {
      const { panel, origin } = (await state(p)).vr,
        m = panel.matrix;
      const x = (px / 1024 - 0.5) * panel.width,
        y = (0.5 - py / 512) * panel.height;
      const target = [
        m[0] * x + m[4] * y + m[12],
        m[1] * x + m[5] * y + m[13],
        m[2] * x + m[6] * y + m[14],
      ];
      await p.evaluate(
        ({ target, origin }) => {
          const c = xrDevice.controllers.right,
            hand = [0.25, 1.3, -0.2];
          c.position.set(...hand);
          const d = target.map((n, i) => n - origin[i] - hand[i]),
            length = Math.hypot(...d),
            [x, y, z] = d.map((n) => n / length),
            norm = Math.hypot(y, -x, 1 - z);
          c.quaternion.set(y / norm, -x / norm, 0, (1 - z) / norm);
        },
        { target, origin },
      );
      await frames();
    };
    const xrAction = async (id) => {
      await p.waitForFunction(() => {
        const c = JSON.parse(window.render_game_to_text()).vr.controls;
        return c && (c.progress === 0 || c.progress === 1);
      });
      const button = (await state(p)).vr.controls.targets.find(
        (b) => b.id === id,
      );
      assert(button, `Missing XR action ${id}`);
      assert(button.enabled, `Disabled XR action ${id}`);
      await aim(button.x + button.w / 2, button.y + button.h / 2);
      await press();
    };
    await p.waitForFunction(
      () => JSON.parse(window.render_game_to_text()).vr.frames > 8,
    );
    assert.equal((await state(p)).vr.views, 2);
    await xrAction("menu.toggle");
    assert.equal((await state(p)).controls.open, true);
    await p.screenshot({ path: `${out}/03-${model}-open.png` });
    await xrAction("flight.start");
    assert.equal((await state(p)).controls.open, false);
    await xrAction("menu.toggle");
    await xrAction("menu.sound");
    await xrAction("sound.louder");
    assert.equal((await state(p)).audio.volume, 40);
    await xrAction("menu.home");
    await xrAction("menu.view");
    const beforeAR = await state(p);
    await xrAction("view.environment");
    const afterAR = await state(p);
    assert.equal(afterAR.vr.displayMode, "ar");
    assert.equal(afterAR.controls.open, false);
    assert.equal(afterAR.lap, beforeAR.lap);
    assert(afterAR.elapsedMs > beforeAR.elapsedMs);
    assert.deepEqual(afterAR.vr.origin, beforeAR.vr.origin);
    await press("squeeze");
    assert.equal((await state(p)).controls.open, true);
    await xrAction("view.environment");
    assert.equal((await state(p)).vr.displayMode, "vr");
    // Clicking where a closed panel used to be cannot execute its hidden buttons.
    await aim(300, 175);
    await press();
    assert.equal((await state(p)).vr.displayMode, "vr");
    assert.equal((await state(p)).controls.open, false);
    await press("squeeze");
    await xrAction("motion.toggle");
    assert.equal((await state(p)).controls.reduced, true);
    await xrAction("menu.toggle");
    assert.equal((await state(p)).vr.controls.progress, 0);
    await press("squeeze");
    await xrAction("menu.home");
    await xrAction("menu.help");
    await p.screenshot({ path: `${out}/04-${model}-guide.png` });
    await xrAction("menu.home");
    await xrAction("menu.view");
    await xrAction("xr.exit");
    await p.waitForFunction(
      () => JSON.parse(window.render_game_to_text()).vr.status === "ready",
    );
    await p.locator("#lab-enter").click();
    await p.waitForFunction(
      () => JSON.parse(window.render_game_to_text()).vr.frames > 8,
    );
    assert.equal((await state(p)).controls.open, false);
    await xrAction("menu.toggle");
    await xrAction("menu.home");
    assert.equal((await state(p)).vr.controls.title, "空のメニュー");
    await p.screenshot({ path: `${out}/05-${model}-reentry.png` });
    ok(
      `${model}: real ray input, bar/open/close, volume, AR round trip, grip recall, hidden hit regions, reduced motion, exit and reentry`,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/results.json`,
    JSON.stringify({ checks, errors }, null, 2),
  );
} finally {
  await browser.close();
}
