import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const out = "output/workshop";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const state = () =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
const step = async (ms) => {
  await page.evaluate((ms) => window.advanceTime(ms), ms);
  await page.waitForTimeout(100);
};
const range = async (label, value) => {
  await page
    .getByRole("slider", { name: label, exact: true })
    .fill(String(value));
  await page.waitForTimeout(100);
};
try {
  await page.goto("http://127.0.0.1:5173");
  await page.waitForFunction(() => typeof window.advanceTime === "function");
  await step(0);
  const initial = await state();
  await page
    .getByRole("button", { name: "つくる実験室 →", exact: true })
    .click();
  assert.equal((await state()).checksum, initial.checksum);
  await range("翼の幅", 80);
  await range("胴体の長さ", 82);
  await page.getByRole("button", { name: "2基", exact: true }).click();
  let s = await state();
  assert.deepEqual(s.aircraftDesign, {
    bodyLengthM: 82,
    wingSpanM: 80,
    engineCount: 2,
  });
  await page
    .getByRole("button", { name: "機体を近くで見る", exact: true })
    .click();
  await page.screenshot({ path: `${out}/01-aircraft.png` });
  // Changing dimensions transforms existing geometry; it should not accumulate new GPU resources.
  const geometries = s.render.geometries;
  for (let i = 0; i < 12; i++) await range("翼の幅", 50 + i * 2);
  assert((await state()).render.geometries <= geometries + 2);
  await page.getByRole("button", { name: "2 航路", exact: true }).click();
  await page
    .getByRole("button", { name: "この2点で航路を作る", exact: true })
    .click();
  s = await state();
  assert.equal(s.routeId, "two-point");
  assert.equal(s.generator.seed, 7);
  assert.equal(s.aircraftDesign.engineCount, 2);
  await page.getByRole("button", { name: "別のゆらぎ", exact: true }).click();
  s = await state();
  assert.equal(s.generator.seed, 8);
  const seed8 = s.checksum;
  await page.getByLabel("シード", { exact: true }).fill("7");
  await page.getByLabel("シード", { exact: true }).blur();
  assert.notEqual((await state()).checksum, seed8);
  await page.getByLabel("シード", { exact: true }).fill("8");
  await page.getByLabel("シード", { exact: true }).blur();
  assert.equal((await state()).checksum, seed8);
  // Place A via the SVG transform; B stays fixed and the invalid intermediate proposal is preserved only as draft.
  await page.getByRole("button", { name: "Aを置く", exact: true }).click();
  const map = page.getByRole("img", { name: "2地点の地図", exact: true });
  await map.scrollIntoViewIfNeeded();
  const box = await map.boundingBox();
  await page.mouse.click(box.x + box.width * 0.22, box.y + box.height * 0.5);
  s = await state();
  assert.notEqual(s.generator.a.x, -1100);
  assert.equal(s.generator.b.x, 1100);
  await range("傾きの追従時間", 2.4);
  assert.equal((await state()).flightSettings.bankResponseSec, 2.4);
  await page.screenshot({ path: `${out}/02-route-controls.png` });
  await page.getByRole("button", { name: "レシピ", exact: true }).click();
  const json = page.getByLabel("レシピJSON", { exact: true });
  const recipe = JSON.parse(await json.inputValue());
  recipe.aircraft.bodyLengthM = 65;
  recipe.route.seed = 77;
  await json.fill(JSON.stringify(recipe, null, 2));
  await page.getByRole("button", { name: "レシピを適用", exact: true }).click();
  s = await state();
  assert.equal(s.generator.seed, 77);
  assert.equal(s.aircraftDesign.bodyLengthM, 65);
  const valid = s.checksum;
  await json.fill('{"version":999}');
  await page.getByRole("button", { name: "レシピを適用", exact: true }).click();
  assert.equal((await state()).checksum, valid);
  assert.equal(await page.getByRole("alert").isVisible(), true);
  await json.fill(JSON.stringify(recipe, null, 2));
  await page.getByRole("button", { name: "レシピを適用", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "レシピを書き出す ↓", exact: true })
    .click();
  const download = await downloadPromise;
  await download.saveAs(`${out}/recipe.json`);
  assert.deepEqual(
    JSON.parse(await fs.readFile(`${out}/recipe.json`, "utf8")),
    recipe,
  );
  await page.screenshot({ path: `${out}/03-json.png` });
  await page.reload();
  await page.waitForFunction(() => typeof window.advanceTime === "function");
  await step(0);
  s = await state();
  assert.equal(s.checksum, valid);
  assert.equal(s.aircraftDesign.engineCount, 2);
  await page.locator("#start-btn").click();
  await step(26000);
  s = await state();
  assert.equal(s.phase, "FLY");
  assert(s.arrivedCount > 0);
  await page.screenshot({ path: `${out}/04-generated-flight.png` });
  await page.getByRole("button", { name: /航路を描き直す/ }).click();
  // The existing height control must still update a generated route.
  await range("空の高さ", 300);
  assert.equal((await state()).generator.altitudeM, 300);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "つくる実験室 →", exact: true })
    .click();
  await page.getByRole("button", { name: "レシピ", exact: true }).click();
  await page.screenshot({ path: `${out}/05-mobile.png`, fullPage: true });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.getByRole("button", { name: "リセット", exact: true }).click();
  s = await state();
  assert.equal(s.generator, null);
  assert.equal(s.aircraftDesign.engineCount, 4);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/result.json`,
    JSON.stringify({ passed: true, scenarios: 12, errors }, null, 2),
  );
  console.log("Workshop browser checks passed: 12 scenarios");
} finally {
  await fs.writeFile(
    `${out}/last-state.json`,
    JSON.stringify(await state(), null, 2),
  );
  await browser.close();
}
