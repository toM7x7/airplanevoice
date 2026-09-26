// Local server settings + twelve-aircraft snapshot fixture. Never calls an AI provider.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
const out = process.env.TRAFFIC_OUTPUT || "output/traffic-vr-2026-09-23/load";
const base = process.env.SHARED_URL || "http://127.0.0.1:8787/";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--autoplay-policy=no-user-gesture-required"],
});
const errors = [],
  checks = [];
const state = (p) => p.evaluate(() => JSON.parse(window.render_game_to_text()));
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "?shared=1");
  await p.waitForFunction(
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).room.status === "connected",
  );
  await p.getByRole("button", { name: "部屋・運営", exact: true }).click();
  const limit = p.getByLabel("同時に飛ばす機体数");
  for (const n of [12, 9, 3, 6]) {
    await limit.selectOption(String(n));
    await p.waitForFunction((n) => {
      const s = JSON.parse(window.render_game_to_text());
      return s.room.state.traffic.capacity === n && !s.room.pending;
    }, n);
  }
  assert(!(await state(p)).room.state.traffic.jev);
  await p.getByText("空の混み具合と判断の履歴", {exact:true}).click();
  await p
    .getByRole("region", { name: "空の運行管理" })
    .screenshot({ path: out + "/operator.png" });
  checks.push("local server persists all four capacity choices; Jev stays off");
  // Compile the fixture with production core, while retaining a real-time rendering clock.
  await p.goto("http://127.0.0.1:5173/");
  const root = `/@fs/${path.resolve("packages/core/src").replaceAll("\\", "/")}`;
  const fixture = await p.evaluate(async (root) => {
    const { newRoom } = await import(root + "/shared-room.ts");
    const { compileShow } = await import(root + "/show.ts");
    const { DEFAULT_WORKSHOP } = await import(root + "/workshop.ts");
    const now = Date.now(),
      s = newRoom(now, true);
    s.traffic = { capacity: 12, jev: false };
    s.persistent = true;
    const show = compileShow({
      version: 1,
      title: "12機の検証",
      flights: Array.from({ length: 12 }, (_, i) => ({
        startSec: 0,
        recipe: {
          ...DEFAULT_WORKSHOP,
          route: {
            ...DEFAULT_WORKSHOP.route,
            altitudeM: 140 + i * 30,
            seed: 10 + i,
          },
        },
      })),
    });
    s.flights = [
      {
        id: "fixture-flight",
        recipe: DEFAULT_WORKSHOP,
        show: show.recipe,
        startsAt: now - 30000,
        endsAt: now - 30000 + show.durationMs,
        clearAt: now - 30000 + show.durationMs + 5000,
        checksum: show.checksum,
        names: show.flights.map((_, i) => `テスト旅客機 ${i + 1}`),
      },
    ];
    return s;
  }, root);
  await p.close();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const runtime = await fs.readFile(
    "node_modules/iwer/build/iwer.min.js",
    "utf8",
  );
  await ctx.addInitScript({
    content: `${runtime}\nwindow.xrDevice=new IWER.XRDevice(IWER.metaQuest3,{stereoEnabled:true});xrDevice.installRuntime({forceInstall:true,polyfillLayers:false});xrDevice.controlMode='programmatic';xrDevice.position.set(0,1.65,0);`,
  });
  await ctx.route("**/api/exhibition", (r) =>
    r.fulfill({ json: { id: "7e7af951-4101-4ecf-9139-a8223354b9c4" } }),
  );
  await ctx.route("**/api/ai/**", (r) =>
    r.fulfill({ status: 403, json: { error: "fixture: AI disabled" } }),
  );
  await ctx.routeWebSocket("**/api/exhibition/connect", (ws) => {
    const envelope = () => ({
      type: "state",
      state: fixture,
      serverNow: Date.now(),
      role: "editor",
      peers: 1,
      participants: [],
      selfId: "fixture",
    });
    ws.send(JSON.stringify(envelope()));
    ws.onMessage((m) => {
      const body = JSON.parse(m);
      ws.send(
        JSON.stringify(
          body.type === "ping"
            ? { type: "pong", serverNow: Date.now(), sentAt: body.sentAt }
            : envelope(),
        ),
      );
    });
  });
  const q = await ctx.newPage();
  q.setDefaultTimeout(30000);
  q.on("pageerror", (e) => errors.push(e.message));
  await q.goto(base + "?shared=1");
  await q.waitForFunction(
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).fleet.filter(
        (f) => f.started && !f.ended,
      ).length === 12,
  );
  await q.getByRole("button", { name: "空を眺める", exact: true }).click();
  await q.locator("#vr-enter").click();
  await q.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).vr.frames > 20,
  );
  const press = async (label) => {
    if (label !== "メニューを開く" && !(await state(q)).vr.controls.open)
      await press("メニューを開く");
    if (label !== "メニューを開く")
      await q.waitForFunction(
        () =>
          JSON.parse(window.render_game_to_text()).vr.controls.progress === 1,
      );
    const { panel, origin, controls } = (await state(q)).vr,
      t = controls.targets.find((t) => t.label === label);
    assert(t && t.enabled, label);
    const x = ((t.x + t.w / 2) / 1024 - 0.5) * panel.width,
      y = (0.5 - (t.y + t.h / 2) / 512) * panel.height,
      m = panel.matrix;
    const target = [
      m[0] * x + m[4] * y + m[12],
      m[1] * x + m[5] * y + m[13],
      m[2] * x + m[6] * y + m[14],
    ];
    await q.evaluate(
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
    const frames = async () => {
      const f = (await state(q)).vr.frames + 5;
      await q.waitForFunction(
        (f) => JSON.parse(window.render_game_to_text()).vr.frames >= f,
        f,
      );
    };
    await frames();
    await q.evaluate(() =>
      xrDevice.controllers.right.updateButtonValue("trigger", 1),
    );
    await frames();
    await q.evaluate(() =>
      xrDevice.controllers.right.updateButtonValue("trigger", 0),
    );
    await frames();
  };
  await press("飛行中の機体");
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const s = await state(q);
    seen.push(
      ...s.vr.controls.targets
        .filter((t) => t.label.includes("テスト旅客機"))
        .map((t) => t.label),
    );
    await q.screenshot({ path: out + `/fleet-${i + 1}.png` });
    if (i < 2) await press("次の4機");
  }
  assert.equal(new Set(seen).size, 12);
  const last = (await state(q)).vr.controls.targets.find((t) =>
    t.label.includes("テスト旅客機 12"),
  );
  await press(last.label);
  assert.equal((await state(q)).inspection?.id, "ST-12");
  await press("空のメニューに戻る");
  await press("音・見え方の設定");
  await press("音量・聴き方");
  await press("音の表現・案内");
  for (const [label,mode] of [["音の厚み","soft"],["細い線","line"],["表示しない","off"]]) {
    await press(label);
    await q.waitForFunction((mode) => window.__soundTrailRender?.soundTrace?.mode===mode,mode);
    await q.waitForTimeout(600);
    const trace=await q.evaluate(()=>window.__soundTrailRender.soundTrace);
    assert(trace.lineSegments<=384);
    if(mode==="soft") assert(trace.segments>0,JSON.stringify(trace));
    else assert.equal(trace.segments,0);
    await q.screenshot({path:out+`/trace-${mode}.png`});
  }
  await press("音の厚み");
  await press("AI発話中の音量調整：オン");
  assert.equal((await state(q)).audio.space.ducking,false);
  await press("AI発話中の音量調整：オフ");
  assert.equal((await state(q)).audio.space.ducking,true);
  await press("音量・聴き方に戻る");
  await press("空のメニューに戻る");
  checks.push("VR sound subpage switches thickness / line / off and voice ducking, with consistent return navigation");
  const info = await q.evaluate(() => window.__soundTrailRender);
  assert.deepEqual(errors, []);
  checks.push(
    "twelve named aircraft render in stereo, paginate across three pages, and aircraft 12 can be selected",
  );
  await fs.writeFile(
    out + "/result.json",
    JSON.stringify({ checks, render: info, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, render: info, errors }));
} finally {
  await browser.close();
}
