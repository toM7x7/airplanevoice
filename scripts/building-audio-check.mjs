import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const p = await browser.newPage();
  await p.goto("http://127.0.0.1:5173/");
  const result = await p.evaluate(async () => {
    const { AircraftAudio } = await import("/src/audio.ts");
    const { environmentPreset, environmentObjects } =
      await import("/@fs/D:/personal_dev/airplanevoice/packages/core/src/environment.ts");
    const audio = new AircraftAudio();
    await audio.enable();
    const recipe = { ...environmentPreset("city"), buildingSound: true },
      b = environmentObjects(recipe).buildings[0];
    const listener = { x: b.x - b.width / 2 - 10, y: 3, z: b.z },
      source = { x: b.x + b.width / 2 + 10, y: 3, z: b.z };
    audio.setListener(listener, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
    const results = [];
    for (const [label, enabled, visible, high] of [
      ["off", false, true, false],
      ["blocked", true, true, false],
      ["above", true, true, true],
      ["ar-hidden", true, false, false],
    ]) {
      audio.setEnvironment({ ...recipe, buildingSound: enabled }, visible);
      audio.setListener(
        { ...listener, y: high ? b.height + 20 : 3 },
        { x: 0, y: 0, z: -1 },
        { x: 0, y: 1, z: 0 },
      );
      audio.play(
        {
          flightId: "ST-01",
          arrivalAtMs: 0,
          distanceM: source.x - listener.x,
          pitchRatio: 1,
          emission: {
            id: 1,
            position: { ...source, y: high ? b.height + 20 : 3 },
          },
        },
        0,
        0,
      );
      const voice = [...audio.voices].at(-1);
      results.push({
        label,
        cutoff: voice.nodes[1].frequency.value,
        strength: audio.buildingSoundState.lastStrength,
        enabled: audio.buildingSoundState.enabled,
      });
      await new Promise((r) => setTimeout(r, 400));
    }
    audio.stop();
    return results;
  });
  assert(result[1].cutoff < result[0].cutoff);
  assert(result[1].strength > 0.9);
  assert.equal(result[2].strength, 0);
  assert.equal(result[3].strength, 0);
  assert.equal(result[3].enabled, false);
  await fs.mkdir("output/consult-fix", { recursive: true });
  await fs.writeFile(
    "output/consult-fix/audio-result.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} finally {
  await browser.close();
}
