// Real local room + browser/XR input; AI responses are fixtures, no provider calls.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = process.env.SHARED_URL || "http://127.0.0.1:8787/";
const out = process.env.CREATION_OUTPUT || "output/creation";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle",
    `--use-angle=${process.env.XR_GL || "swiftshader"}`,
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ],
});
const checks = [],
  errors = [];
const ok = (n) => {
  checks.push(n);
  console.log("OK", n);
};
const state = (p) => p.evaluate(() => JSON.parse(window.render_game_to_text()));
const ready = (p) =>
  p.waitForFunction(
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).room.status === "connected" &&
      !JSON.parse(window.render_game_to_text()).room.pending,
  );
try {
  const pc = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    quest = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
  const emulation = await fs.readFile(
    "node_modules/iwer/build/iwer.min.js",
    "utf8",
  );
  await quest.addInitScript({
    content: `${emulation}\nwindow.xrDevice=new IWER.XRDevice(IWER.metaQuest3,{stereoEnabled:true});xrDevice.installRuntime({forceInstall:true,polyfillLayers:false});xrDevice.controlMode='programmatic';xrDevice.position.set(0,1.65,0);sessionStorage.setItem('av-ai-trial','fixture');`,
  });
  const a = await pc.newPage(),
    b = await quest.newPage();
  a.setDefaultTimeout(60000);
  b.setDefaultTimeout(60000);
  for (const p of [a, b]) p.on("pageerror", (e) => errors.push(e.message));
  let reply = null,
    context = null;
  let observing = false;
  const results = [],
    routes = [];
  const status = () => ({
    enabled: true,
    expiresAt: null,
    configured: { openai: true, typesafe: true },
    limits: {
      observations: null,
      replies: null,
      conversations: null,
      voiceSeconds: null,
      observationMs: 10000,
      staleMs: 20000,
    },
    used: { observations: 0, replies: 0, conversations: 0 },
    observer: { on: observing, note: "検証用", at: 0, error: "" },
    live: { status: "idle", deadline: null, seconds: null, error: "" },
    reply,
  });
  await b.route("**/api/ai/**", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1);
    routes.push(name);
    const data = route.request().postDataJSON() ?? {};
    if (name === "observe") observing = data.on;
    if (name === "context") context = data.context;
    if (name === "ask") {
      const action =
        data.text === "音を重くして"
          ? { mode: "apply", control: "creation", value: "tone:0" }
          : { mode: "guide", control: "creation", value: "fly" };
      reply = {
        id: crypto.randomUUID(),
        text: "検証用の操作",
        guide: "none",
        revision: context.revision,
        command: {
          id: crypto.randomUUID(),
          action,
          expiresAt: Date.now() + 30000,
        },
      };
    }
    if (name === "action-result") {
      results.push(data);
      reply = { ...reply, text: "確認済み" };
      delete reply.command;
    }
    await route.fulfill({
      status: 200,
      json:
        name === "ask"
          ? reply
          : name === "action-result"
            ? { text: "確認済み" }
            : status(),
    });
  });
  await a.goto(base + "?shared=1&private=1");
  await a.getByRole("button", { name: "部屋・運営", exact: true }).click();
  await a
    .getByRole("button", { name: "展示用の部屋をつくる（8時間）", exact: true })
    .click();
  await ready(a);
  await a.locator(".room-invite summary").click();
  await a.getByAltText("共有する部屋の招待QR").waitFor();
  const invite = await a.getByLabel("部屋の招待URL").inputValue();
  await b.goto(invite.replace("?shared=1", "?shared=1&ai=guide"));
  await ready(b);
  assert.equal((await state(b)).room.role, "viewer");
  await a.getByRole("button", { name: "つくる", exact: true }).click();
  await a.getByRole("button", { name: "部屋にも保存", exact: true }).click();
  await ready(a);
  await b.waitForFunction(() =>
    JSON.parse(window.render_game_to_text()).hangar.some(
      (e) => e.name === "私の旅客機",
    ),
  );
  assert.equal((await state(b)).room.state.flights.length, 0);
  ok(
    "PC passes an aircraft to Quest without launching or overwriting the shared draft",
  );
  await b.getByRole("button", { name: "つくる", exact: true }).click();
  const choose = (v) =>
    b.locator(`.workbench [data-creation-action="${v}"]`).click();
  const category = (name) =>
    b
      .getByRole("navigation", { name: "機体の編集項目" })
      .getByRole("button", { name: new RegExp(name) })
      .click();
  await choose("shape:1");
  await category("色");
  await choose("color:2");
  await category("音");
  await choose("tone:2");
  await choose("listen");
  await b.waitForTimeout(300);
  assert.equal((await state(b)).audio.state, "running");
  await category("名前");
  await b.getByRole("textbox", { name: "制作中の機体の名前" }).fill("ひかり");
  await b.getByRole("textbox", { name: "制作中の機体の名前" }).press("Tab");
  await choose("save");
  const original = (await state(b)).creation.entry;
  assert.equal(original.name, "ひかり");
  assert.equal(original.recipe.aircraft.color, "#a54840");
  await b.screenshot({ path: out + "/01-pc-creation.png" });
  await b.reload();
  await ready(b);
  await b.getByRole("button", { name: /ひかり.*2発/ }).click();
  await b.getByRole("button", { name: "この機体を使う", exact: true }).click();
  assert.deepEqual((await state(b)).creation.entry, original);
  ok("participant creates, auditions, names, saves and recalls after reload");
  // The real assistant adapter processes a fixture tool result.
  await b.getByRole("button", { name: "案内を開く", exact: true }).click();
  await b.getByLabel("操作や飛行について").fill("音を重くして");
  await b.getByRole("button", { name: "相談する", exact: true }).click();
  await b.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).creation.entry.recipe.aircraft
        .sound.air === 0.08,
  );
  for(let i=0;i<100 && results.at(-1)?.ok !== true;i++) await b.waitForTimeout(50);
  assert.equal(results.at(-1)?.ok, true);
  ok("assistant tool changes the same draft as buttons, without launching");
  await b.getByRole("button", { name: "案内を開く", exact: true }).click();
  await b.getByLabel("操作や飛行について").fill("飛ばす場所を教えて");
  await b.getByRole("button", { name: "相談する", exact: true }).click();
  await b.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).creation.step === 3,
  );
  assert.equal((await state(b)).room.state.flights.length, 0);
  await b
    .locator('.workbench [data-creation-action="fly"][data-guide="true"]')
    .waitFor();
  ok("guidance reveals the final button and never launches on its own");
  const stops = routes.filter((r) => r === "stop").length;
  await b.evaluate(
    () =>
      (window.creationAudio = document.querySelector(
        'audio[aria-label="AIの音声"]',
      )),
  );
  await b.locator("#vr-enter").click();
  await b.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).vr.frames > 10,
  );
  assert.equal(
    await b.evaluate(
      () =>
        window.creationAudio ===
        document.querySelector('audio[aria-label="AIの音声"]'),
    ),
    true,
  );
  assert.equal(routes.filter((r) => r === "stop").length, stops);
  assert.equal((await state(b)).vr.views, 2);
  await b.screenshot({ path: out + "/02-vr-creation.png" });
  ok(
    "XR entry preserves the voice component and shows the creation menu in stereo",
  );
  const frames = async (n = 4) => {
    const target = (await state(b)).vr.frames + n;
    await b.waitForFunction((n) => {
      const vr = JSON.parse(window.render_game_to_text()).vr;
      return vr.status !== "presenting" || vr.frames >= n;
    }, target);
  };
  const press = async (label) => {
    if (label !== "メニューを開く" && !(await state(b)).vr.controls.open) await press("メニューを開く");
    if (label !== "メニューを開く") await b.waitForFunction(
      () => JSON.parse(window.render_game_to_text()).vr.controls.progress === 1,
    );
    const { panel, origin, controls } = (await state(b)).vr;
    const t = controls.targets.find((t) => t.label === label);
    assert(t && t.enabled, label);
    const x = ((t.x + t.w / 2) / 1024 - 0.5) * panel.width,
      y = (0.5 - (t.y + t.h / 2) / 512) * panel.height,
      m = panel.matrix;
    const target = [
      m[0] * x + m[4] * y + m[12],
      m[1] * x + m[5] * y + m[13],
      m[2] * x + m[6] * y + m[14],
    ];
    await b.evaluate(
      ({ target, origin }) => {
        const c = xrDevice.controllers.right;
        c.position.set(0.25, 1.3, -0.2);
        const d = target.map((v, i) => v - origin[i] - [0.25, 1.3, -0.2][i]),
          l = Math.hypot(...d),
          [x, y, z] = d.map((v) => v / l),
          n = Math.hypot(y, -x, 1 - z);
        c.quaternion.set(y / n, -x / n, 0, (1 - z) / n);
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
  const tool = async (action) => {
    const before = results.length;
    reply = { id: crypto.randomUUID(), text: "模擬ツール応答", guide: "none", revision: context.revision,
      command: { id: crypto.randomUUID(), action, expiresAt: Date.now() + 30000 } };
    for (let i = 0; i < 200 && results.length === before; i++) await b.waitForTimeout(100);
    assert(results.length > before, "tool result acknowledged");
    assert.equal(results.at(-1).ok, true, JSON.stringify(action));
    return results.at(-1).context;
  };
  assert(context.hangar.some(e => e.name === "ひかり"), "AI receives real saved names");
  const draftId = (await state(b)).creation.entry.id;
  const otherId = context.hangar.find(e => e.name === "私の旅客機").id;
  await tool({ mode: "apply", control: "hangar", value: "open" });
  const pending = await tool({ mode: "apply", control: "hangar", value: "load:" + otherId });
  assert.equal(pending.ui.pendingAircraftId, otherId);
  assert.equal((await state(b)).creation.entry.id, draftId, "unsaved draft preserved");
  await press("続けて編集する");
  await press("この機体を保存");
  await b.waitForFunction(()=>JSON.parse(window.render_game_to_text()).audio.space.lastCue === "saved");
  await tool({ mode: "apply", control: "hangar", value: "load:" + draftId });
  assert.equal((await state(b)).creation.entry.name, "ひかり");
  assert(!(await state(b)).presentation.switchPending);
  await tool({ mode: "apply", control: "menu", value: "sound" });
  assert.equal((await state(b)).vr.sharedPage, "機体をつくる · 音");
  await tool({ mode: "apply", control: "creation", value: "tone:2" });
  assert.equal((await state(b)).creation.entry.recipe.aircraft.sound.air, .14);
  await tool({ mode: "apply", control: "creation", value: "tone:0" });
  await tool({ mode: "guide", control: "creation", value: "fly" });
  assert((await state(b)).vr.controls.targets.some(t => t.label === "この機体を飛ばす" && t.highlight));
  assert.equal((await state(b)).room.state.flights.length, 0);
  await b.screenshot({ path: out + "/08-vr-ai-guide.png" });
  ok("named hangar tool protects dirty draft, recalls saved name, opens sound menu and highlights flight in XR");
  await press("名前");
  await press("キーボードで入力");
  await press("全消");
  for (const key of ["そ", "ら"]) await press(key);
  await b.screenshot({ path: out + "/04-vr-keyboard.png" });
  await press("取消");
  assert.equal((await state(b)).creation.entry.name, "ひかり");
  await press("キーボードで入力");
  await press("全消");
  for (const key of ["ひ", "か", "り"]) await press(key);
  await press("確定");
  assert.equal((await state(b)).creation.entry.name, "ひかり");
  assert.equal((await state(b)).vr.status, "presenting");
  ok("in-world keyboard confirms and cancels without leaving XR");
  await press("模型の位置・大きさ");
  const modelBefore = (await state(b)).vr.creationModel;
  await press("右へ回す");
  await press("大きく");
  const modelAfter = (await state(b)).vr.creationModel;
  assert(modelAfter.scale > modelBefore.scale);
  assert.notDeepEqual(modelAfter.rotation, modelBefore.rotation);
  await press("手元へ戻す");
  const model = (await state(b)).vr.creationModel,
    origin = (await state(b)).vr.origin;
  await b.evaluate(
    ({ target, origin }) => {
      const c = xrDevice.controllers.right;
      c.position.set(0.25, 1.3, -0.2);
      const d = target.map((v, i) => v - origin[i] - [0.25, 1.3, -0.2][i]),
        l = Math.hypot(...d),
        [x, y, z] = d.map((v) => v / l),
        n = Math.hypot(y, -x, 1 - z);
      c.quaternion.set(y / n, -x / n, 0, (1 - z) / n);
    },
    { target: model.position, origin },
  );
  await frames();
  await b.evaluate(() =>
    xrDevice.controllers.right.updateButtonValue("trigger", 1),
  );
  await frames();
  assert.equal((await state(b)).vr.creationModel.held, true);
  await b.evaluate(() => (xrDevice.controllers.right.position.x += 0.12));
  await frames();
  assert.notDeepEqual(
    (await state(b)).vr.creationModel.position,
    model.position,
  );
  await b.evaluate(() =>
    xrDevice.controllers.right.updateButtonValue("trigger", 0),
  );
  await frames();
  assert.equal((await state(b)).vr.creationModel.held, false);
  await press("向きを戻す");
  await b.screenshot({ path: out + "/05-vr-model.png" });
  await press("制作に戻る");

  ok("miniature turns, scales, recentres and moves with a held XR ray");
  await press("AI相談");
  assert(!(await state(b)).vr.controls.targets.some(t => t.label.includes("Jev")));
  assert((await state(b)).creation.open);
  await press("名前");
  assert((await state(b)).creation.open);
  await press("AI相談");
  ok("XR creation keeps conversation access while backstage Jev controls stay in the operator panel");
  const pinnedBeforeFlight = (await state(b)).vr.panel.matrix;
  await press("この機体を飛ばす");
  await ready(b);
  await frames(12);
  assert.deepEqual((await state(b)).vr.panel.matrix, pinnedBeforeFlight, "departure does not relocate the menu");
  await a.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).room.state.flights.length === 1,
  );
  const ar = (await state(a)).room.state,
    br = (await state(b)).room.state;
  assert.equal(ar.flights[0].names[0], "ひかり");
  assert.equal(ar.flights[0].recipe.aircraft.sound.body, 1);
  assert.equal(ar.flights[0].recipe.aircraft.color, "#a54840");
  assert.deepEqual(ar.flights, br.flights);
  assert(ar.hangar.some((e) => e.name === "ひかり"));
  ok(
    "visitor launches with an actual XR ray; PC receives the named aircraft and sound",
  );
  await b.waitForFunction(() => JSON.parse(window.render_game_to_text()).fleet.some(f => f.name === "ひかり" && f.started));
  for (let i = 0; i < 100 && !context?.fleet.some(f => f.name === "ひかり"); i++) await b.waitForTimeout(100);
  assert(context.fleet.some(f => f.name === "ひかり"), "AI receives launched user name, not only internal ST number");
  assert.deepEqual((await state(b)).vr.panel.matrix, pinnedBeforeFlight, "takeoff animation does not relocate the menu");
  ok("menu stays pinned through submission and actual takeoff; live context carries the assigned aircraft name");
  if ((await state(b)).vr.canShowAR) {
    await press("ARで見る");
    assert.equal((await state(b)).vr.displayMode, "ar");
    assert.equal((await state(b)).creation.open, false);
    ok("AR observation closes creation and retains the flight");
  } else await press("空のメニューに戻る");
  await press("飛行中の機体");
  assert((await state(b)).vr.controls.targets.some(t=>t.label.includes("ひかり")));
  await b.screenshot({path:out+"/07-xr-fleet.png"});
  await press("空のメニューに戻る");
  ok("XR flight roster exposes the named aircraft after departure submission");
  await press("保存した機体");
  await press(
    (await state(b)).vr.controls.targets.find((t) =>
      t.label.includes("ひかり（この部屋）"),
    ).label,
  );
  await press(
    (await state(b)).creation.dirty ? "保存せず切り替える" : "この機体を使う",
  );
  assert.equal((await state(b)).creation.entry.recipe.aircraft.sound.body, 1);
  ok("VR recalls the immutable room aircraft for a new draft");
  await b.screenshot({ path: out + "/03-vr-recall.png" });
  await press("空のメニューに戻る");
  await press("AIと相談");
  assert(!(await state(b)).vr.controls.targets.some(t => t.label.includes("Jev")));
  await b.screenshot({ path: out + "/06-xr-ai.png" });
  await press("空のメニューに戻る");
  await press("音・見え方の設定");
  await press("音量・聴き方");
  await press("音量 −5");
  await press("音の表現・案内");
  await press("細い線");
  assert.equal((await state(b)).audio.trace,"line");
  await press("音の厚み");
  await press("音量・聴き方に戻る");
  await b.screenshot({ path: out + "/09-xr-audio.png" });
  await press("空のメニューに戻る");
  await press("音・見え方の設定");
  await press("ブラウザに戻る");
  await b.getByRole("button", { name: "AI案内を閉じる" }).click();
  await b.locator("#vr-enter").click();
  await b.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).vr.status === "presenting",
  );
  await press("空のメニューに戻る");
  await press("AIと相談");
  await press("AIを準備する");
  await b.waitForFunction(() =>
    JSON.parse(window.render_game_to_text()).vr.controls.targets.some(
      (t) => t.label === "会話を始める" && t.enabled,
    ),
  );
  assert.equal((await state(b)).vr.status, "presenting");
  ok(
    "XR returns through consistent navigation and prepares the authenticated conversation without leaving immersion",
  );
  assert.deepEqual(errors, []);
  assert(!routes.some((r) => r.startsWith("live")));
  ok("no page errors or paid AI calls");
  await fs.writeFile(
    out + "/result.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
} finally {
  await browser.close();
}
