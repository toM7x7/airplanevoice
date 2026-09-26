import { expect, it } from "vitest";
import { soundPresence } from "../packages/core/src/sound-presence";
it("appears after arrival and fades away instead of strengthening behind an aircraft", () => {
  expect(soundPresence(-1, 5000).opacity).toBe(0);
  expect(soundPresence(0, 5000).opacity).toBe(0);
  expect(soundPresence(500, 5000).opacity).toBeGreaterThan(
    soundPresence(1500, 5000).opacity,
  );
  expect(soundPresence(1500, 5000).opacity).toBeGreaterThan(
    soundPresence(4000, 5000).opacity,
  );
  expect(soundPresence(5000, 5000).opacity).toBe(0);
  expect(soundPresence(10, 0).opacity).toBe(0);
  for (let ms = 0; ms <= 5000; ms += 10) {
    const value = soundPresence(ms, 5000, 99);
    expect(value.opacity).toBeGreaterThanOrEqual(0);
    expect(value.opacity).toBeLessThanOrEqual(1);
    expect(value.radius).toBeLessThanOrEqual(3.2);
  }
});
