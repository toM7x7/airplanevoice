// Local UI integration with mocked AI replies; never calls paid providers.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const out = "output/consult-fix";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
let reply = null,
  snapshot = null,
  asks = 0,
  results = [];
const status = () => ({
  enabled: true,
  configured: { openai: true, typesafe: true },
  observer: { on: false, note: "テスト", at: 0 },
  live: { status: "closed", seconds: 0 },
  used: { conversations: 0, replies: asks, observations: 0 },
  reply,
});
await context.route("**/api/ai/**", async (route) => {
  const path = new URL(route.request().url()).pathname.split("/").pop(),
    body = route.request().postDataJSON();
  let data = status();
  if (path === "access") data = { publicDemo: true };
  if (path === "context") {
    snapshot = body.context;
    data = status();
  }
  if (path === "ask") {
    asks++;
    const design = body.text.startsWith("【Jev機体案】");
    reply = {
      id: body.id,
      text: design
        ? "Jevの案：尾翼の色を下書きに反映します。エンジン数は候補が分かれたため、今の設定を保ちます。"
        : "都市の下書きを表示します。",
      guide: "none",
      revision: snapshot.revision,
      command: {
        id: crypto.randomUUID(),
        expiresAt: Date.now() + 30000,
        action: {
          mode: "apply",
          control: design ? "creation" : "environment",
          value: design
            ? "design:" +
              JSON.stringify({
                ...snapshot.creation.aircraft,
                color: "#334455",
              })
            : "city",
        },
      },
    };
    data = { ...reply };
    delete data.id;
  }
  if (path === "action-result") {
    results.push(body);
    data = { text: "下書きに反映しました。" };
  }
  await route.fulfill({ json: data });
});
const p = await context.newPage(),
  q = await context.newPage(),
  errors = [];
await q.route("**/api/ai/**", (r) =>
  r.fulfill({ status: 403, json: { error: "Peer AI disabled in test" } }),
);
p.on("pageerror", (e) => errors.push(e.message));
const state = () => p.evaluate(() => JSON.parse(window.render_game_to_text()));
try {
  await p.goto("http://127.0.0.1:8787/?shared=1");
  await p.waitForFunction(
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).room.status === "connected",
  );
  await p.getByRole("button", { name: "空を眺める", exact: true }).click();
  await p.getByRole("button", { name: "空間づくり", exact: true }).click();
  const panel = p.getByRole("complementary", { name: "空間づくり" });
  await panel.getByLabel("景色の名前", { exact: true }).fill("夕暮れの街");
  await panel
    .getByLabel("作りたい景色を文字で相談", { exact: true })
    .fill("都市にして");
  const before = (await state()).room.state.environment;
  await panel
    .getByRole("button", { name: "景色の案を相談する", exact: true })
    .click();
  await panel.getByRole("status").filter({ hasText: "下書きに反映" }).waitFor();
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.deepEqual((await state()).room.state.environment, before);
  assert.equal(
    await panel
      .getByRole("button", { name: "都市", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await panel.getByLabel("建物で音がこもる表現を試す").check();
  await p.screenshot({ path: out + "/environment.png" });
  await panel
    .getByRole("button", { name: "みんなの空に反映", exact: true })
    .click();
  await q.goto("http://127.0.0.1:8787/?shared=1");
  await q.waitForFunction(
    () =>
      window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).room.state?.environment?.name ===
        "夕暮れの街",
  );
  assert.equal(
    (await q.evaluate(() => JSON.parse(window.render_game_to_text()))).room
      .state.environment.buildingSound,
    true,
  );
  await panel.getByRole("button", { name: "閉じる", exact: true }).click();
  await p.getByRole("button", { name: "つくる", exact: true }).click();
  await p.getByRole("button", { name: "案内を開く", exact: true }).click();
  await p
    .getByPlaceholder("例：細身の双発機で、尾翼を紺色に")
    .fill("尾翼を紺色に");
  await p
    .getByRole("button", { name: "Jevで機体案を作る", exact: true })
    .click();
  await p
    .locator(".av-ai-reply")
    .filter({ hasText: "エンジン数は候補が分かれた" })
    .waitFor();
  await p.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).creation.entry.recipe.aircraft
        .color === "#334455",
  );
  await p
    .locator(".av-ai-reply")
    .filter({ hasText: "下書きに反映しました" })
    .waitFor();
  assert.equal((await state()).creation.entry.recipe.aircraft.color, "#334455");
  assert.equal(results.length, 2);
  assert.equal(results[1].ok, true);
  await p.screenshot({ path: out + "/jev-draft.png" });
  assert.deepEqual(errors, []);
  assert.equal(asks, 2);
  await fs.writeFile(
    out + "/ui-result.json",
    JSON.stringify(
      { asks, actions: results.map((x) => x.ok), errors, name: "夕暮れの街" },
      null,
      2,
    ),
  );
  console.log(
    "Inline scenery consultation, named shared environment and partial Jev draft: passed",
  );
} catch (e) {
  await p.screenshot({ path: out + "/failure.png" });
  throw e;
} finally {
  await browser.close();
}
