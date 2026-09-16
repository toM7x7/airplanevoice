import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

// Dev-only comparison harness. Never moves the observer or the clock in the shipped app.
const base = process.env.TEST_URL || "http://127.0.0.1:5173/";
const out = process.env.QUALITY_OUTPUT || "output/quality";
const baseline = process.env.QUALITY_BASELINE === "1";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(base);
  await page.waitForFunction(() => typeof window.advanceTime === "function");
  const step = async (ms) => {
    await page.evaluate((ms) => window.advanceTime(ms), ms);
    await page.waitForTimeout(100);
  };
  const state = () =>
    page.evaluate(() => JSON.parse(window.render_game_to_text()));
  await step(0);
  await page.locator("#start-btn").click();
  await step(26000);
  const observations = [];
  for (const [name, time] of [
    ["approach", 0],
    ["pass", 10000],
    ["recede", 12000],
  ]) {
    await step(time);
    await page
      .getByRole("button", { name: "機体情報を表示", exact: true })
      .click();
    await page
      .getByRole("button", { name: "この機体の方を向く ↗", exact: true })
      .click();
    await page
      .getByRole("button", { name: "機体情報を閉じる", exact: true })
      .click();
    await step(0);
    assert((await state()).aircraftTargets.some((p) => p.id === "ST-01"));
    await page.screenshot({ path: `${out}/flight-${name}.png` });
    observations.push({ name, state: await state() });
  }
  // Separate close views explain shape/material changes; they are not evidence of
  // ground-distance visibility. Render the actual app component, not a test model.
  await page.evaluate(async (baseline) => {
    const resources = performance
      .getEntriesByType("resource")
      .map((r) => r.name);
    const dep = (name) =>
      resources.find((url) => new URL(url).pathname.endsWith(`/${name}.js`));
    const reactModule = await import(dep("react"));
    const React = reactModule.default ?? reactModule;
    const domModule = await import(dep("react-dom_client"));
    const { createRoot } = domModule.default ?? domModule;
    const { Canvas, useThree, useFrame } = await import(
      dep("@react-three_fiber")
    );
    const { Aircraft } = await import("/src/Aircraft.tsx");
    const Lighting = baseline
      ? null
      : (await import("/src/SkyEnvironment.tsx")).SkyEnvironment;
    // Hide the app during close inspection; page teardown releases both runtimes.
    document.querySelector("#root").style.display = "none";
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;inset:0;background:#aecad5;z-index:10000";
    document.body.append(host);
    const h = React.createElement;
    window.qualityProbe = {
      camera: [110, 32, 145],
      design: { bodyLengthM: 71, wingSpanM: 64, engineCount: 4 },
      renderer: null,
    };
    function Probe() {
      const { camera, gl, scene } = useThree();
      useFrame(() => {
        camera.position.fromArray(window.qualityProbe.camera);
        camera.lookAt(0, 0, 0);
        window.qualityProbe.renderer = {
          calls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
          geometries: gl.info.memory.geometries,
          textures: gl.info.memory.textures,
          environment: !!scene.environment,
        };
      });
      return h(
        React.Fragment,
        null,
        Lighting
          ? h(Lighting)
          : h(
              React.Fragment,
              null,
              h("color", { attach: "background", args: ["#aecad5"] }),
              h("hemisphereLight", { args: ["#ebf5ff", "#667a60", 2.2] }),
              h("directionalLight", {
                position: [-1500, 3500, 1800],
                intensity: 3,
                color: "#fff3d7",
              }),
            ),
        h(Aircraft, { design: window.qualityProbe.design }),
      );
    }
    const root = createRoot(host);
    window.renderQualityProbe = () =>
      root.render(
        h(
          Canvas,
          {
            camera: { fov: 30, near: 0.1, far: 24000 },
            dpr: 1,
            gl: { antialias: true },
          },
          h(Probe),
        ),
      );
    window.disposeQualityProbe = () => root.unmount();
    window.renderQualityProbe();
  }, baseline);
  await page.waitForFunction(() => window.qualityProbe?.renderer);
  const probes = [];
  for (const [name, camera, design] of [
    [
      "four-engine",
      [110, 32, 145],
      { bodyLengthM: 71, wingSpanM: 64, engineCount: 4 },
    ],
    [
      "underside",
      [-95, -36, 110],
      { bodyLengthM: 71, wingSpanM: 64, engineCount: 4 },
    ],
    [
      "two-engine",
      [110, 28, 145],
      { bodyLengthM: 62, wingSpanM: 60, engineCount: 2 },
    ],
    [
      "wide-short",
      [110, 30, 145],
      { bodyLengthM: 50, wingSpanM: 85, engineCount: 4 },
    ],
    [
      "long-narrow",
      [110, 30, 145],
      { bodyLengthM: 85, wingSpanM: 45, engineCount: 2 },
    ],
  ]) {
    await page.evaluate(
      ({ camera, design }) => {
        Object.assign(window.qualityProbe, { camera, design });
        window.renderQualityProbe();
      },
      { camera, design },
    );
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${out}/model-${name}.png` });
    const metrics = await page.evaluate(() => window.qualityProbe.renderer);
    if (!baseline)
      assert(
        metrics.environment,
        "Model should receive the generated sky reflection",
      );
    probes.push({ name, camera, design, metrics });
  }
  await page.evaluate(() => window.disposeQualityProbe());
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/result.json`,
    JSON.stringify(
      { passed: true, baseline, observations, probes, errors },
      null,
      2,
    ),
  );
  console.log(
    `Quality comparison: 3 flight views + 5 model views passed. ${out}`,
  );
} finally {
  await browser.close();
}
