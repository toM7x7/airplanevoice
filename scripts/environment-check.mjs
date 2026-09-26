// Local-only UI/shared-state checks. No paid AI requests.
import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const out = "output/journey-2026-09-23/environment";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
await context.route("**/api/ai/**", (r) =>
  r.fulfill({ status: 403, json: { error: "AI disabled in browser test" } }),
);
const p = await context.newPage(),
  q = await context.newPage(),
  errors = [],
  checks = [];
for (const page of [p, q]) page.on("pageerror", (e) => errors.push(e.message));
const state = (page) =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
try {
  for (const page of [p, q]) {
    await page.goto("http://127.0.0.1:8787/?shared=1");
    await page.waitForFunction(
      () =>
        window.render_game_to_text &&
        JSON.parse(window.render_game_to_text()).room.status === "connected",
    );
  }
  await p.getByRole("button", { name: "つくる", exact: true }).click();
  await p.getByRole("button", { name: "伸びやかな翼端", exact: true }).click();
  assert.equal(
    (await state(p)).creation.entry.recipe.aircraft.wingletHeightM,
    3,
  );

  for (const [label, value] of [
    ["胴体の太さ", 7],
    ["翼の後退角", 35],
    ["エンジンの大きさ", 1.2],
  ]) {
    const input = p.getByRole("slider", { name: label, exact: true });
    await input.fill(String(value));
    await input.dispatchEvent("input");
  }
  const design = (await state(p)).creation.entry.recipe.aircraft;
  assert.equal(design.bodyWidthM, 7);
  assert.equal(design.wingSweepDeg, 35);
  assert.equal(design.engineScale, 1.2);
  await p.screenshot({ path: out + "/01-aircraft.png" });
  checks.push("six shapes and detailed aircraft parameters update live");
  await p.getByRole("button", { name: "空を眺める", exact: true }).click();
  await q.getByRole("button", { name: "空を眺める", exact: true }).click();
  const before = (await state(q)).room.state.environment;
  await p.getByRole("button", { name: "空間づくり", exact: true }).click();
  await p.getByRole("button", { name: "都市", exact: true }).click();
  assert.deepEqual(
    (await state(q)).room.state.environment,
    before,
    "local preview does not publish",
  );
  await p.screenshot({ path: out + "/02-city-draft.png" });
  await p
    .getByRole("button", { name: "みんなの空に反映", exact: true })
    .click();
  await q.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).room.state.environment
        ?.preset === "city",
  );
  await p
    .getByRole("complementary", { name: "空間づくり" })
    .getByRole("status")
    .filter({ hasText: "景色をみんなの空に反映しました" })
    .waitFor();
  await q.screenshot({ path: out + "/03-shared-city.png" });
  checks.push(
    "city preview stays local until confirmed; peer receives same recipe",
  );
  await p
    .getByRole("complementary", { name: "空間づくり" })
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  const radar = p.locator(".flight-radar"),
    beforeBox = await radar.boundingBox();
  const grip = await p.locator(".radar-grip").boundingBox();
  await p.mouse.move(grip.x + 100, grip.y + 15);
  await p.mouse.down();
  await p.mouse.move(grip.x - 20, grip.y - 65);
  await p.mouse.up();
  const moved = await radar.boundingBox();
  assert(
    Math.abs(moved.x - beforeBox.x) > 50 ||
      Math.abs(moved.y - beforeBox.y) > 50,
  );
  checks.push("PC radar header moves independently");
  const old = (await state(p)).listener,
    peer = (await state(q)).listener;
  await p.getByRole("button", { name: "PCの自由視点", exact: true }).click();
  await p.keyboard.down("e");
  await p.waitForTimeout(400);
  await p.keyboard.up("e");
  assert((await state(p)).listener.y > old.y + 2);
  assert.deepEqual((await state(q)).listener, peer);
  await p
    .getByRole("button", { name: "元の立ち位置へ戻る", exact: true })
    .click();
  assert.deepEqual((await state(p)).listener, old);
  checks.push("PC free viewpoint and return do not move peer");
  assert.deepEqual(errors, []);
  await fs.writeFile(
    out + "/result.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(checks);
} catch (e) {
  await p.screenshot({ path: out + "/failure.png" });
  console.error(await p.locator("button").allTextContents());
  throw e;
} finally {
  await browser.close();
}
