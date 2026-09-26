import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const out = process.env.WORKBENCH_OUTPUT || "output/workbench";
const url = process.env.SHARED_URL || "http://127.0.0.1:8788/?shared=1";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const state = () =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
const button = (name) => page.getByRole("button", { name, exact: true });
const category = (name) =>
  page
    .getByRole("navigation", { name: "機体の編集項目" })
    .getByRole("button", { name: new RegExp(name) });
const snap = async (name) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/${name}.png` });
};
try {
  await page.goto(url);
  await page.waitForFunction(
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).vr.creationModel,
  );
  assert.equal((await state()).presentation.place, "hangar");
  await snap("01-hangar");
  await button("この機体を編集").click();
  const initial = (await state()).creation.entry.recipe;
  await button("長い翼の双発").click();
  await category("色").click();
  await button("金色").click();
  const draft = structuredClone((await state()).creation.entry);
  for (const [label, bg] of [
    ["格納庫", "hangar"],
    ["空港", "airport"],
    ["空", "sky"],
  ]) {
    await page
      .getByRole("group", { name: "背景を見比べる" })
      .getByRole("button", { name: label, exact: true })
      .click();
    assert.equal((await state()).presentation.background, bg);
    assert.deepEqual((await state()).creation.entry, draft);
    await snap(`02-edit-${bg}`);
  }
  const before = (await state()).vr.creationModel;
  await button("右へ回す").click();
  await button("大きく").click();
  assert.notDeepEqual(
    (await state()).vr.creationModel.rotation,
    before.rotation,
  );
  assert((await state()).vr.creationModel.scale > before.scale);
  await category("音").click();
  await button("深い響き・気流少し強め").click();
  await button("今の音を聴く").click();
  assert.equal((await state()).audio.state, "running");
  await snap("03-sound");
  await category("航路").click();
  await button("斜めの往復").click();
  assert.notDeepEqual(
    (await state()).creation.entry.recipe.route,
    initial.route,
  );
  await category("名前").click();
  await page
    .getByRole("textbox", { name: "制作中の機体の名前" })
    .fill("ひかり・金の翼");
  await page.getByRole("textbox", { name: "制作中の機体の名前" }).press("Tab");
  await button("格納庫に保存").click();
  assert.equal((await state()).creation.dirty, false);
  const saved = (await state()).creation.entry;
  await page.reload();
  await page.waitForFunction(
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).vr.creationModel,
  );
  assert.equal((await state()).creation.dirty, false);
  await page.getByRole("button", { name: /ひかり・金の翼.*2発/ }).click();
  await button("この機体を使う").click();
  assert.deepEqual((await state()).creation.entry, saved);
  await category("色").click();
  await button("赤").click();
  await page
    .getByRole("navigation", { name: "体験の場所" })
    .getByRole("button", { name: "格納庫", exact: true })
    .click();
  await page.getByRole("button", { name: /ひかり・金の翼.*2発/ }).click();
  await snap("04-switch-guard");
  await button("続けて編集する").click();
  assert.equal((await state()).creation.entry.recipe.aircraft.color, "#a54840");
  assert.equal((await state()).presentation.place, "edit");
  await page
    .getByRole("navigation", { name: "体験の場所" })
    .getByRole("button", { name: "格納庫", exact: true })
    .click();
  await page.getByRole("button", { name: /ひかり・金の翼.*2発/ }).click();
  await button("保存せず切り替える").click();
  assert.deepEqual((await state()).creation.entry, saved);
  await button("この機体を飛ばす").click();
  await page.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).presentation.place === "observe",
    {},
    { timeout: 30000 },
  );
  const room = (await state()).room;
  assert.equal(room.state.flights.length, 1);
  assert.equal(room.state.flights[0].names[0], saved.name);
  await snap("05-observe");
  const canvas = await page.locator("canvas").elementHandle();
  await button("この機体を編集").click();
  await button("空港").click();
  assert.equal(
    (await state()).room.state.flights[0].id,
    room.state.flights[0].id,
  );
  assert.equal(await canvas.evaluate((node) => node.isConnected), true);
  await snap("06-edit-while-flying");
  await page.setViewportSize({ width: 390, height: 844 });
  await snap("07-mobile");
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/checks.json`,
    JSON.stringify(
      {
        passed: [
          "three backgrounds retain draft",
          "model rotation and zoom",
          "audition",
          "route changes",
          "Japanese name and save",
          "reload preserves saved state",
          "switch cancellation/discard",
          "launch to observation",
          "editing retains shared flight and canvas",
          "mobile without horizontal overflow",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS workbench: edit / compare / save / switch guard / launch / re-edit / mobile",
  );
} catch (error) {
  await snap("failure");
  console.error({
    presentation: (await state()).presentation,
    message: (await state()).creation.message,
    roomError: (await state()).room.error,
  });
  throw error;
} finally {
  await browser.close();
}
