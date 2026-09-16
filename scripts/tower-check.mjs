import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";

const base = process.env.SHARED_URL || "http://127.0.0.1:8787/";
const out = process.env.TOWER_OUTPUT || "output/tower";
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
  console.log(`OK ${s}`);
};
const state = (page) =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
const wait = (page, fn, arg) =>
  page.waitForFunction(fn, arg, { timeout: 30000 });
const speechMock = () => {
  window.spoken = [];
  window.speechCancels = 0;
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      getVoices: () => [{ lang: "ja-JP", name: "Test voice" }],
      addEventListener() {},
      removeEventListener() {},
      speak(s) {
        window.spoken.push({ text: s.text, volume: s.volume });
      },
      cancel() {
        window.speechCancels++;
      },
    },
  });
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
};
try {
  const pc = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const quest = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await pc.addInitScript(speechMock);
  await quest.addInitScript(speechMock);
  const iwer = await fs.readFile("node_modules/iwer/build/iwer.min.js", "utf8");
  await quest.addInitScript({
    content: `${iwer}\nwindow.xrDevice=new IWER.XRDevice(IWER.metaQuest3,{stereoEnabled:true});xrDevice.installRuntime({forceInstall:true,polyfillLayers:false});xrDevice.controlMode='programmatic';xrDevice.position.set(0,1.65,0);`,
  });
  const a = await pc.newPage(),
    b = await quest.newPage();
  for (const p of [a, b]) p.on("pageerror", (e) => errors.push(e.message));
  await a.goto(new URL("?shared=1", base).href);
  await a
    .getByRole("button", { name: "共有する部屋をつくる", exact: true })
    .click();
  await wait(
    a,
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).room.status === "connected",
  );
  await b.goto(a.url());
  await wait(
    b,
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).room.status === "connected",
  );
  await a.locator(".room-tower summary").click();
  await a.getByRole("button", { name: "音を聴く", exact: true }).click();
  await a
    .getByRole("button", { name: "状況を読み上げる", exact: true })
    .click();
  assert.equal((await state(a)).tower.source, "rules");
  assert.equal(await a.evaluate(() => spoken.length), 1);
  assert.equal(await b.evaluate(() => spoken.length), 0);
  await a.getByRole("button", { name: "自分の音を休む", exact: true }).click();
  assert.equal((await state(a)).tower.speech.speaking, false);
  ok("Explicit readout is local, labelled as rules, and rest cancels it");
  await a.locator("#shared-launch").click();
  await wait(
    a,
    () => JSON.parse(window.render_game_to_text()).tower.phase === "flying",
  );
  const flying = (await state(a)).tower.current;
  await a
    .getByRole("button", { name: "状況を読み上げる", exact: true })
    .click();
  await b.getByLabel("共有高度を上げる").click();
  await wait(
    a,
    () => !JSON.parse(window.render_game_to_text()).tower.speech.speaking,
  );
  const facts = (await state(a)).tower;
  assert.deepEqual(facts.current, flying);
  assert.equal(facts.draft.altitudeM, flying.settings.altitudeM + 20);
  ok(
    "Peer edit cancels stale speech and keeps the flying snapshot separate from the draft",
  );
  await a
    .getByRole("button", { name: "状況を読み上げる", exact: true })
    .click();
  await pc.setOffline(true);
  await wait(
    a,
    () => JSON.parse(window.render_game_to_text()).tower.phase === "offline",
  );
  assert.equal((await state(a)).tower.speech.speaking, false);
  assert.equal((await state(a)).tower.current, null);
  await pc.setOffline(false);
  await wait(
    a,
    () => JSON.parse(window.render_game_to_text()).room.status === "connected",
  );
  ok(
    "Offline stops the announcement and hides unverified schedule facts; reconnect restores them",
  );
  await a.locator(".room-tower").scrollIntoViewIfNeeded();
  await a.screenshot({ path: `${out}/01-pc-tower.png` });
  await b.locator("#vr-enter").click();
  await wait(b, () => JSON.parse(window.render_game_to_text()).vr.frames > 10);
  const frames = async () => {
    const n = (await state(b)).vr.frames + 3;
    await wait(
      b,
      (n) => {
        const v = JSON.parse(window.render_game_to_text()).vr;
        return v.status === "ready" || v.frames >= n;
      },
      n,
    );
  };
  const press = async (px, py) => {
    const { panel, origin } = (await state(b)).vr,
      m = panel.matrix;
    const x = (px / 1024 - 0.5) * panel.width,
      y = (0.5 - py / 512) * panel.height;
    const target = [
      m[0] * x + m[4] * y + m[12],
      m[1] * x + m[5] * y + m[13],
      m[2] * x + m[6] * y + m[14],
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
  await press(260, 434); // Main -> view.
  await press(757, 434); // View -> tower (new unused slot).
  assert.equal((await state(b)).vr.sharedPage, "管制 / 状況・案内");
  const before = await state(b);
  await press(260, 371); // Read.
  assert.equal((await state(b)).tower.speech.speaking, true);
  await press(757, 371); // Stop.
  assert.equal((await state(b)).tower.speech.speaking, false);
  assert.equal(
    (await state(b)).room.state.revision,
    before.room.state.revision,
  );
  assert.equal((await state(b)).playbackId, before.playbackId);
  await b.screenshot({ path: `${out}/02-xr-tower.png` });
  ok(
    "XR controller opens tower and reads/stops without changing the shared flight",
  );
  await press(260, 371);
  await press(757, 452); // Tower -> view.
  await press(260, 434); // View -> exit.
  await wait(
    b,
    () => JSON.parse(window.render_game_to_text()).vr.status === "ready",
  );
  assert.equal((await state(b)).tower.speech.speaking, false);
  ok("XR exit cancels speech");
  // A separate browser with no Japanese voice must remain usable.
  const fallback = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await fallback.addInitScript(() =>
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        getVoices: () => [],
        addEventListener() {},
        removeEventListener() {},
      },
    }),
  );
  const c = await fallback.newPage();
  await c.goto(a.url());
  await wait(
    c,
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).room.status === "connected",
  );
  await c.locator(".room-tower summary").click();
  assert.equal(
    await c
      .getByRole("button", { name: "状況を読み上げる", exact: true })
      .isDisabled(),
    true,
  );
  assert.match(await c.locator(".room-tower").innerText(), /文字で確認/);
  await c.locator(".room-tower").scrollIntoViewIfNeeded();
  await c.screenshot({ path: `${out}/03-mobile-text.png` });
  ok("No Japanese voice falls back to text on a narrow screen");
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/results.json`,
    JSON.stringify(
      {
        checks,
        errors,
        speech: "mock transport only; physical Quest voice remains unverified",
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
