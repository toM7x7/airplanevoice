// Public smoke test: inserts one uniquely named probe, then removes only that probe.
import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const out = "output/cloud-exhibition/public";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11"] });
const errors = [], checks = [];
const url = "https://airplanevoice.pages.dev/?shared=1";
const ready = p => p.waitForFunction(() => window.render_game_to_text && JSON.parse(window.render_game_to_text()).room.status === "connected" && !JSON.parse(window.render_game_to_text()).room.pending);
const state = p => p.evaluate(() => JSON.parse(window.render_game_to_text()));
let a, b, entry;
try {
  const pc = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const second = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  a = await pc.newPage(); b = await second.newPage();
  for (const p of [a, b]) { p.setDefaultTimeout(45000); p.on("pageerror", e => errors.push(e.message)); }
  await a.goto(url); await ready(a); await b.goto(url); await ready(b);
  assert.equal((await state(a)).room.state.persistent, true);
  assert.deepEqual((await state(a)).room.state.flights, (await state(b)).room.state.flights);
  const js = await a.locator('script[type="module"][src]').getAttribute("src");
  assert.match(js, /index-DTQpC05-/);
  checks.push("public Pages serves the new build and both independent browsers join the same persistent flights");
  await a.getByRole("button", { name: "この機体を編集", exact: true }).click();
  await a.getByRole("navigation", { name: "機体の編集項目" }).getByRole("button", { name: /名前/ }).click();
  const name = `同期確認用${Date.now()}`;
  await a.getByRole("textbox", { name: "制作中の機体の名前", exact: true }).fill(name);
  await a.getByRole("textbox", { name: "制作中の機体の名前", exact: true }).press("Tab");
  entry = (await state(a)).creation.entry;
  await a.locator('.workbench [data-creation-action="save"]').click();
  await b.waitForFunction(id => JSON.parse(window.render_game_to_text()).room.state.hangar?.some(e => e.id === id), entry.id);
  await a.waitForFunction(() => JSON.parse(window.render_game_to_text()).creation.message.includes("クラウド格納庫に保存しました"));
  checks.push("a real public cloud save reaches the other browser's hangar");
  await b.reload(); await ready(b);
  assert.deepEqual((await state(b)).room.state.hangar.find(e => e.id === entry.id), entry);
  await b.locator(".wb-aircraft-list button").filter({ hasText: name }).waitFor();
  await b.screenshot({ path: `${out}/cloud-hangar.png` });
  checks.push("the saved aircraft survives a browser reload and is available in the public hangar list");
  assert.deepEqual(errors, []);
} finally {
  try {
    if (a && entry && (await state(a)).room.state?.hangar?.some(e => e.id === entry.id)) {
      await a.getByRole("button", { name: "部屋・運営", exact: true }).click();
      await ready(a);
      await a.locator(".creation-shelf li").filter({ hasText: entry.name }).getByRole("button", { name: "クラウド格納庫から外す", exact: true }).click();
      await a.waitForFunction(id => !JSON.parse(window.render_game_to_text()).room.state.hangar.some(e => e.id === id), entry.id);
      if (b && !b.isClosed()) await b.waitForFunction(id => !JSON.parse(window.render_game_to_text()).room.state.hangar.some(e => e.id === id), entry.id);
      checks.push("only the test aircraft is removed; public exhibition continues");
    }
    await fs.writeFile(`${out}/results.json`, JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ checks, errors }, null, 2));
  } finally { await browser.close(); }
}
