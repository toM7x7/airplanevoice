import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const baseline = process.env.AUDIO_BASELINE === "1";
if (
  baseline &&
  JSON.parse(await fs.readFile("package.json", "utf8")).version !== "0.5.0"
)
  throw new Error(
    "The historical baseline must be recorded from the v0.5.0 checkout.",
  );
const coreUrl = `/@fs/${path.resolve("packages/core/src/index.ts").replaceAll("\\", "/")}`;
const out = "output/audio-output";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-gl=angle",
    "--use-angle=swiftshader",
  ],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5173/");
  const results = [];
  const cases = baseline
    ? [{ count: 1 }, { count: 3 }]
    : [
        { count: 1 },
        { count: 3 },
        { count: 3, stress: true },
        { count: 3, headphones: true },
      ];
  for (const { count, stress = false, headphones = false } of cases) {
    const result = await page.evaluate(
      async ({ count, baseline, stress, headphones, coreUrl }) => {
        const { AircraftAudio } = await import("/src/audio.ts");
        const { Experience } = await import(coreUrl);
        const audio = new AircraftAudio(),
          experience = new Experience();
        let output;
        const create = AudioContext.prototype.createDynamicsCompressor;
        AudioContext.prototype.createDynamicsCompressor = function () {
          const node = create.call(this);
          output = node;
          return node;
        };
        await audio.enable();
        AudioContext.prototype.createDynamicsCompressor = create;
        if (!baseline)
          audio.setOutputProfile(headphones ? "headphones" : "speaker");
        if (stress) audio.setVolume(0.7);
        experience.setAirspace({ aircraftCount: count, spacingSec: 0 });
        experience.setMix("balanced");
        audio.setMix(experience.mixGains);
        audio.setListener(
          experience.listener,
          { x: 0, y: 0, z: -1 },
          { x: 0, y: 1, z: 0 },
        );
        experience.onArrival = (a, now) =>
          audio.play(a, now, experience.recipe.lowFrequencyGain);
        experience.start(1.6);
        experience.advance(18000);
        audio.stop();
        // Read stereo waveforms after each aircraft's panner and mix gain, and after
        // the final compressor. This is signal evidence, not a physical loudness test.
        const taps = new Map();
        function tap(id, node) {
          const split = audio.context.createChannelSplitter(2);
          const channels = [0, 1].map((i) => {
            const a = audio.context.createAnalyser();
            a.fftSize = 2048;
            split.connect(a, i);
            return a;
          });
          node.connect(split);
          taps.set(id, { split, channels, data: new Float32Array(2048) });
        }
        tap("output", output);
        let previous = performance.now(),
          live = true;
        let emission = 0,
          emittedAt = 0,
          maxVoices = 0;
        function tick(now) {
          if (!live) return;
          if (!stress)
            experience.advance(Math.max(0, Math.min(100, now - previous)));
          else if (now - emittedAt >= 35) {
            emittedAt = now;
            for (const flightId of experience.flightIds) {
              audio.play(
                {
                  flightId,
                  arrivalAtMs: now,
                  distanceM: 50,
                  pitchRatio: 1.35,
                  emission: {
                    id: emission++,
                    emitAtMs: now - 150,
                    position: { x: 0, y: 2, z: -50 },
                    velocity: { x: 0, y: 0, z: 0 },
                  },
                },
                now,
                1,
              );
            }
          }
          maxVoices = Math.max(maxVoices, audio.activeVoices);
          previous = now;
          for (const [id, bus] of audio.buses) if (!taps.has(id)) tap(id, bus);
          requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        await new Promise((resolve) => setTimeout(resolve, 800));
        const samples = [];
        for (let i = 0; i < 45; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const values = {};
          for (const [id, t] of taps) {
            let sum = 0,
              peak = 0;
            for (const a of t.channels) {
              a.getFloatTimeDomainData(t.data);
              for (const n of t.data) {
                sum += n * n;
                peak = Math.max(peak, Math.abs(n));
              }
            }
            values[id] = { rms: Math.sqrt(sum / (2 * t.data.length)), peak };
          }
          samples.push(values);
        }
        const outputRms = () => {
          const t = taps.get("output");
          let energy = 0;
          for (const a of t.channels) {
            a.getFloatTimeDomainData(t.data);
            for (const n of t.data) energy += n * n;
          }
          return Math.sqrt(energy / (2 * t.data.length));
        };
        let mutedRms, zeroVolumeRms, restoredRms, stoppedRms;
        if (!baseline) {
          audio.setMuted(true);
          await new Promise((resolve) => setTimeout(resolve, 550));
          mutedRms = outputRms();
          audio.setMuted(false);
          audio.setVolume(0);
          await new Promise((resolve) => setTimeout(resolve, 550));
          zeroVolumeRms = outputRms();
          audio.setVolume(stress ? 0.7 : 0.35);
          await new Promise((resolve) => setTimeout(resolve, 550));
          restoredRms = outputRms();
        }
        live = false;
        audio.stop();
        await new Promise((resolve) => setTimeout(resolve, 550));
        stoppedRms = outputRms();
        const ids = [...taps.keys()];
        const mean = Object.fromEntries(
          ids.map((id) => {
            const rms = Math.sqrt(
              samples.reduce((n, s) => n + (s[id]?.rms ?? 0) ** 2, 0) /
                samples.length,
            );
            return [
              id,
              {
                rms,
                db: rms > 0 ? 20 * Math.log10(rms) : -120,
                peak: Math.max(...samples.map((s) => s[id]?.peak ?? 0)),
              },
            ];
          }),
        );
        const concurrent = samples.filter((s) =>
          experience.flightIds.every((id) => s[id]?.rms > 0.00001),
        ).length;
        const result = {
          count,
          stress,
          headphones,
          maxVoices,
          mutedRms,
          zeroVolumeRms,
          restoredRms,
          stoppedRms,
          mix: experience.mixMode,
          played: audio.playedByFlight,
          mean,
          concurrent,
          sampleCount: samples.length,
          context: audio.context.state,
          phase: experience.phase,
          nowMs: experience.nowMs,
        };
        taps.forEach((t) => {
          t.split.disconnect();
          t.channels.forEach((a) => a.disconnect());
        });
        audio.dispose();
        return result;
      },
      { count, baseline, stress, headphones, coreUrl },
    );
    console.log(JSON.stringify(result));
    results.push(result);
    assert.equal(Object.keys(result.played).length, count);
    if (!baseline)
      assert(
        result.concurrent > 20,
        "Each plane must produce a waveform during the same samples",
      );
    assert(result.mean.output.peak < 0.98, "Output must retain headroom");
    assert(result.maxVoices <= count * 6, "Voice budgets must remain bounded");
    if (!baseline) {
      assert(
        result.mutedRms < 0.00001 && result.zeroVolumeRms < 0.00001,
        "Mute and zero volume must silence the output waveform",
      );
      assert(
        result.restoredRms > 0.00001,
        "Restoring volume must restore the output waveform",
      );
      assert(
        result.stoppedRms < 0.00001,
        "Pause must drain the output waveform",
      );
    }
  }
  if (!baseline) {
    assert(
      results[1].mean.output.db > results[3].mean.output.db + 3,
      "Speaker profile must raise actual output relative to headphone profile",
    );
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${out}/${baseline ? "baseline-v0.5" : "speaker-current"}.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
} finally {
  await browser.close();
}
