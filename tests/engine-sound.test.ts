import { describe, it, expect } from "vitest";
import { engineSignal } from "../apps/desktop/src/engine-sound";

function legacySignal(rate: number) {
  const data = new Float32Array(rate * 4);
  let seed = 92821,
    low = 0;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff) * 2 - 1;
    low = low * 0.96 + noise * 0.04;
    data[i] =
      low * 1.7 +
      noise * 0.1 +
      Math.sin((i / rate) * Math.PI * 2 * 61) * 0.07 +
      Math.sin((i / rate) * Math.PI * 2 * 123) * 0.03;
  }
  return data;
}
function bands(data: Float32Array, rate: number) {
  const smooth = (hz: number) => 1 - Math.exp((-2 * Math.PI * hz) / rate);
  let low = 0,
    mid = 0,
    top = 0,
    sum = 0,
    body = 0,
    hiss = 0,
    peak = 0;
  for (const v of data) {
    low += smooth(160) * (v - low);
    mid += smooth(650) * (v - mid);
    top += smooth(1800) * (v - top);
    sum += v * v;
    body += (mid - low) ** 2;
    hiss += (v - top) ** 2;
    peak = Math.max(peak, Math.abs(v));
  }
  return {
    rms: Math.sqrt(sum / data.length),
    peak,
    body: body / sum,
    hiss: hiss / sum,
  };
}
describe("authored passenger-engine sound", () => {
  it.each([44100, 48000])(
    "balances two and four engines and reduces hiss at %s Hz",
    (rate) => {
      const baseline = bands(legacySignal(rate), rate);
      for (const count of [2, 4] as const) {
        const sound = engineSignal(rate, count),
          measured = bands(sound, rate);
        if (process.env.SOUND_REPORT)
          console.log({ rate, count, baseline, measured });
        expect(measured.rms).toBeCloseTo(0.155, 4);
        expect(measured.peak).toBeLessThan(0.9);
        expect(measured.hiss).toBeLessThan(baseline.hiss * 0.45);
        expect(measured.body).toBeGreaterThan(baseline.body * 1.1);
      }
      expect(engineSignal(rate, 2)).not.toEqual(engineSignal(rate, 4));
    },
  );
  it("reproduces a pattern and rejects unsupported formats", () => {
    expect(engineSignal(8000, 4, 0.1)).toEqual(engineSignal(8000, 4, 0.1));
    for (const rate of [0, NaN, Infinity, 200000])
      expect(() => engineSignal(rate, 4)).toThrow();
  });
});
