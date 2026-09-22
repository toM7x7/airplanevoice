import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const out = process.env.GRAB_OUTPUT || "output/menu-voice-2026-09-23/grab";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const runtime = await fs.readFile(
  "node_modules/iwer/build/iwer.min.js",
  "utf8",
);
await context.addInitScript({
  content: `${runtime}\nwindow.xrDevice=new IWER.XRDevice(IWER.metaQuest3,{stereoEnabled:true});xrDevice.installRuntime({forceInstall:true,polyfillLayers:false});xrDevice.controlMode='programmatic';xrDevice.position.set(0,1.65,0);`,
});
const p = await context.newPage(),
  errors = [],
  checks = [];
p.on("pageerror", (e) => errors.push(e.message));
p.setDefaultTimeout(30000);
const state = () => p.evaluate(() => JSON.parse(window.render_game_to_text()));
const frames = async (n = 5) => {
  const f = (await state()).vr.frames + n;
  await p.waitForFunction(
    (f) => JSON.parse(window.render_game_to_text()).vr.frames >= f,
    f,
  );
};
const point = (panel, x, y) => {
  const m = panel.matrix;
  return [
    m[0] * x + m[4] * y + m[12],
    m[1] * x + m[5] * y + m[13],
    m[2] * x + m[6] * y + m[14],
  ];
};
try {
  const url = new URL(process.env.SHARED_URL || "http://127.0.0.1:8787/");
  url.searchParams.set("shared", "1");
  await p.goto(url.href);
  await p.getByRole("button", { name: "つくる", exact: true }).click();
  await p.locator("#vr-enter").click();
  await p.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).vr.frames > 10,
  );
  const s = await state(),
    target = s.vr.panelHandles[1];
  await p.evaluate(
    ({ target, origin }) => {
      const c = xrDevice.controllers.right;
      c.position.set(0.1, 1.4, -0.2);
      const d = target.map((v, i) => v - origin[i] - [0.1, 1.4, -0.2][i]),
        l = Math.hypot(...d),
        [x, y, z] = d.map((v) => v / l),
        n = Math.hypot(y, -x, 1 - z);
      c.quaternion.set(y / n, -x / n, 0, (1 - z) / n);
    },
    { target, origin: s.vr.origin },
  );
  await frames();
  await p.evaluate(() =>
    xrDevice.controllers.right.updateButtonValue("trigger", 1),
  );
  await frames();
  assert((await state()).vr.panelHeld, "controller grabs right handle");
  const before = (await state()).vr.panel.matrix,
    modelBefore = (await state()).vr.creationModel.position;
  await p.evaluate(() => (xrDevice.controllers.right.position.x += 0.1));
  await frames();
  assert.notDeepEqual((await state()).vr.panel.matrix, before);
  assert.deepEqual((await state()).vr.creationModel.position, modelBefore);
  await p.evaluate(() =>
    xrDevice.controllers.right.updateButtonValue("trigger", 0),
  );
  await frames();
  assert(!(await state()).vr.panelHeld);
  checks.push("controller moves menu without moving the model");
  await p.screenshot({ path: out + "/controller-layout.png" });
  const pinned = (await state()).vr.panel.matrix;
  await p.evaluate(() => { xrDevice.position.set(.2,1.7,.1); xrDevice.quaternion.set(0,.15,0,Math.sqrt(1-.15*.15)); xrDevice.primaryInputMode = "hand"; });
  await p.waitForFunction(() =>
    JSON.parse(window.render_game_to_text()).vr.hands.some(
      (h) => h.hand === "right" && h.tracked,
    ),
  );
  await frames();
  assert.deepEqual((await state()).vr.panel.matrix, pinned, "head/input changes keep the board fixed");
  checks.push("head movement and controller-to-hand transition do not relocate the menu");
  const moveGrip = async (target) => {
    const grip = (await state()).vr.hands.find((h) => h.hand === "right").grip;
    await p.evaluate(
      (delta) => {
        const h = xrDevice.hands.right;
        h.position.set(
          h.position.x + delta[0],
          h.position.y + delta[1],
          h.position.z + delta[2],
        );
      },
      target.map((v, i) => v - grip[i]),
    );
    await frames();
  };
  await moveGrip((await state()).vr.creationModel.position);
  await p.evaluate(() => xrDevice.hands.right.updatePinchValue(1));
  await frames(12);
  assert(
    (await state()).vr.creationModel.held,
    "near pinch grabs aircraft body",
  );
  const held = (await state()).vr.creationModel.position;
  await p.evaluate(() => (xrDevice.hands.right.position.x += 0.12));
  await frames();
  assert(
    Math.abs((await state()).vr.creationModel.position[0] - held[0] - 0.12) <
      0.01,
  );
  await p.evaluate(() => xrDevice.hands.right.updatePinchValue(0));
  await frames(12);
  assert(!(await state()).vr.creationModel.held);
  checks.push("near finger pinch holds, translates and releases aircraft");
  await moveGrip((await state()).vr.panelHandles[0]);
  await fs.writeFile(out+"/before-handle.json",JSON.stringify((await state()).vr,null,2));
  await p.evaluate(() => xrDevice.hands.right.updatePinchValue(1));
  await frames(12);
  await fs.writeFile(out+"/after-handle.json",JSON.stringify((await state()).vr,null,2));
  assert((await state()).vr.panelHeld, "hand pinch grabs left handle");
  const panel = (await state()).vr.panel.matrix;
  await p.evaluate(() => (xrDevice.hands.right.position.y += 0.08));
  await frames();
  assert.notDeepEqual((await state()).vr.panel.matrix, panel);
  await p.evaluate(() => xrDevice.hands.right.updatePinchValue(0));
  await frames(12);
  assert(!(await state()).vr.panelHeld);
  checks.push("near finger pinch moves and releases the left menu handle");
  const fixed = (await state()).vr.panel.matrix;
  await p.evaluate(() => { xrDevice.hands.right.position.set(0,1.2,-.1); xrDevice.hands.right.updatePinchValue(1); });
  await frames(12);
  assert(!(await state()).vr.panelHeld, "unrelated pinch cannot re-grab using old contact");
  assert.deepEqual((await state()).vr.panel.matrix, fixed, "unrelated pinching cannot drag board");
  for (let i=0; i<3; i++) {
    await p.evaluate(() => { xrDevice.primaryInputMode = "controller"; }); await frames(5);
    await p.evaluate(() => { xrDevice.primaryInputMode = "hand"; }); await frames(5);
  }
  assert.deepEqual((await state()).vr.panel.matrix, fixed, "tracking reacquisition never moves menu");
  checks.push("unrelated pinches and repeated input discovery keep released menu fixed");
  await p.screenshot({ path: out + "/hands-layout.png" });
  await p.evaluate(() => xrDevice.hands.right.updatePinchValue(0));await frames(12);
  assert((await state()).vr.radar.visible,"radar starts open");
  const menuFixed=(await state()).vr.panel.matrix;
  await moveGrip((await state()).vr.radar.handles[0]);
  await p.evaluate(() => xrDevice.hands.right.updatePinchValue(1));await frames(12);
  assert((await state()).vr.radar.held,"near pinch grabs radar handle");
  const radarBefore=(await state()).vr.radar.matrix;
  await p.evaluate(() => xrDevice.hands.right.position.y+=.12);await frames();
  assert.notDeepEqual((await state()).vr.radar.matrix,radarBefore);
  assert.deepEqual((await state()).vr.panel.matrix,menuFixed,"radar movement leaves menu fixed");
  await p.evaluate(() => xrDevice.hands.right.updatePinchValue(0));await frames(12);
  assert(!(await state()).vr.radar.held);
  const radarFixed=(await state()).vr.radar.matrix;
  await p.evaluate(() => xrDevice.position.x+=.15);await frames();
  assert.deepEqual((await state()).vr.radar.matrix,radarFixed,"released radar stays fixed while head moves");
  checks.push("independent radar handle pinch, move, release and head-motion stability");
  await p.screenshot({path:out+"/radar-moved.png"});
  assert.deepEqual(errors, []);
  await fs.writeFile(
    out + "/result.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(checks);
} catch (e) {
  await fs.writeFile(
    out + "/failure.json",
    JSON.stringify({error:String(e),state:await state().catch(()=>null),errors}, null, 2),
  );
  await p.screenshot({ path: out + "/failure.png" });
  throw e;
} finally {
  await browser.close();
}
