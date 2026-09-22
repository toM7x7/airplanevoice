import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const out = process.env.HAND_OUTPUT || "output/hand-controls";
await fs.mkdir(out, { recursive: true });
const emulation = await fs.readFile(
  "node_modules/iwer/build/iwer.min.js",
  "utf8",
);
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const errors = [],
  checks = [];
const state = (p) => p.evaluate(() => JSON.parse(window.render_game_to_text()));
try {
  for (const model of ["metaQuest3", "metaQuest2"]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    await context.addInitScript({
      content: `${emulation}\nwindow.xrDevice=new IWER.XRDevice(IWER.${model},{stereoEnabled:true});xrDevice.installRuntime({forceInstall:true,polyfillLayers:false});xrDevice.controlMode='programmatic';xrDevice.position.set(0,1.65,0);xrDevice.primaryInputMode='hand';`,
    });
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(
      new URL(
        "?ui=components",
        process.env.TEST_URL || "http://127.0.0.1:5173/",
      ).href,
    );
    await p.waitForFunction(
      () =>
        window.render_game_to_text &&
        JSON.parse(window.render_game_to_text()).vr.status === "ready",
    );
    await p.locator("#lab-enter").click();
    await p.waitForFunction(
      () =>
        JSON.parse(window.render_game_to_text()).vr.inputMode === "hands" &&
        JSON.parse(window.render_game_to_text()).vr.frames > 8,
    );
    const frames = async (n = 4) => {
      const until = (await state(p)).vr.frames + n;
      await p.waitForFunction(
        (until) => JSON.parse(window.render_game_to_text()).vr.frames >= until,
        until,
      );
    };
    const target = async (id) => {
      await p.waitForFunction(() =>
        [0, 1].includes(
          JSON.parse(window.render_game_to_text()).vr.controls.progress,
        ),
      );
      const s = await state(p),
        b = s.vr.controls.targets.find((b) => b.id === id);
      assert(b?.enabled, `Missing/enabled: ${id}`);
      const m = s.vr.panel.matrix,
        x = ((b.x + b.w / 2) / 1024 - 0.5) * 2.4,
        y = (0.5 - (b.y + b.h / 2) / 512) * 1.2;
      return {
        world: [
          m[0] * x + m[4] * y + m[12],
          m[1] * x + m[5] * y + m[13],
          m[2] * x + m[6] * y + m[14],
        ],
        normal: [m[8], m[9], m[10]].map((v) => v / 0.3),
      };
    };
    const pinch = async (id) => {
      const t = await target(id),
        s = await state(p);
      await p.evaluate(
        ({ t, origin }) => {
          const h = xrDevice.hands.right,
            pos = [0.18, 1.32, -0.1];
          h.position.set(...pos);
          const d = t.world.map((v, i) => v - origin[i] - pos[i]),
            len = Math.hypot(...d),
            [x, y, z] = d.map((v) => v / len),
            n = Math.hypot(y, -x, 1 - z);
          h.quaternion.set(y / n, -x / n, 0, (1 - z) / n);
        },
        { t, origin: s.vr.origin },
      );
      await frames();
      await p.evaluate(() => xrDevice.hands.right.updatePinchValue(1));
      await frames();
      await p.evaluate(() => xrDevice.hands.right.updatePinchValue(0));
      await frames();
    };
    assert(Math.abs((await state(p)).vr.panel.matrix[0] - 0.3) < 0.0001);
    await pinch("menu.toggle");
    assert.equal((await state(p)).controls.open, true);
    await pinch("menu.sound");
    assert.equal((await state(p)).controls.page, "sound");
    const moveTip = async (t, depth) => {
      const tip = (await state(p)).vr.hands.find((h) => h.hand === "right").tip;
      assert(tip);
      const delta = t.world.map((v, i) => v + t.normal[i] * depth - tip[i]);
      await p.evaluate((delta) => {
        const h = xrDevice.hands.right;
        h.position.set(
          h.position.x + delta[0],
          h.position.y + delta[1],
          h.position.z + delta[2],
        );
      }, delta);
      await frames();
    };
    const louder = await target("sound.louder");
    await moveTip(louder, 0.07);
    await moveTip(louder, 0.004);
    assert.equal((await state(p)).audio.volume, 40);
    await frames(20);
    assert.equal((await state(p)).audio.volume, 40, "hold must not repeat");
    await p.evaluate(() => xrDevice.hands.right.updatePinchValue(1));
    await frames();
    assert.equal(
      (await state(p)).audio.volume,
      40,
      "near pinch must not duplicate touch",
    );
    await p.evaluate(() => xrDevice.hands.right.updatePinchValue(0));
    await frames();
    await moveTip(louder, 0.07);
    await moveTip(louder, 0.004);
    assert.equal((await state(p)).audio.volume, 45);
    await p.screenshot({ path: `${out}/${model}-touch.png` });
    await p.evaluate(() => {
      xrDevice.hands.right.connected = false;
    });
    await frames();
    await p.evaluate(() => {
      xrDevice.hands.right.connected = true;
    });
    await frames();
    assert.equal(
      (await state(p)).audio.volume,
      45,
      "reacquiring a finger at the panel must not press",
    );
    await moveTip(louder, 0.07);
    await moveTip(louder, 0.004);
    assert.equal((await state(p)).audio.volume, 50);
    await pinch("menu.home");
    await pinch("menu.view");
    await pinch("view.environment");
    assert.equal((await state(p)).vr.displayMode, "ar");
    assert.equal((await state(p)).controls.open, false);
    const bar = await target("menu.toggle");
    await moveTip(bar, 0.07);
    await moveTip(bar, 0.004);
    assert.equal((await state(p)).controls.open, true);
    await frames(12);
    await p.screenshot({ path: `${out}/${model}-ar.png` });
    await p.evaluate(() => {
      xrDevice.primaryInputMode = "controller";
    });
    await frames();
    assert.equal((await state(p)).vr.inputMode, "controllers");
    assert.equal((await state(p)).vr.panel.matrix[0], 1);
    checks.push(
      `${model}: far pinch, reachable panel, touch/release/hold, pinch dedupe, lost/reacquired hand, AR, controller fallback`,
    );
    console.log("OK", checks.at(-1));
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
