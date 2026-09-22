import { it, expect } from "vitest";
import { buildingSound } from "../packages/core/src/building-sound";
const building = { x: 0, z: 0, width: 12, depth: 12, height: 20, tone: 0 };
it("colors only the direct path through a building and responds to listener movement", () => {
  const source = { x: 30, y: 5, z: 0 };
  const blocked = buildingSound(source, { x: -30, y: 5, z: 0 }, [building]);
  expect(blocked.strength).toBeCloseTo(1);
  expect(blocked.gain).toBeCloseTo(0.6);
  expect(blocked.cutoffHz).toBeCloseTo(800);
  expect(
    buildingSound(source, { x: 20, y: 5, z: 0 }, [building]).strength,
  ).toBe(0);
  expect(
    buildingSound(source, { x: -30, y: 5, z: 40 }, [building]).strength,
  ).toBe(0);
  expect(
    buildingSound({ x: 30, y: 25, z: 0 }, { x: -30, y: 25, z: 0 }, [building])
      .strength,
  ).toBe(0);
  expect(buildingSound(source, { x: -30, y: 5, z: 0 }, []).gain).toBe(1);
});
it("handles parallel rays, zero distance and partial obstruction without excessive attenuation", () => {
  expect(
    buildingSound({ x: 0, y: 5, z: 0 }, { x: 0, y: 5, z: 0 }, [building])
      .strength,
  ).toBe(0);
  expect(
    buildingSound({ x: 20, y: 5, z: 30 }, { x: 20, y: 5, z: -30 }, [building])
      .strength,
  ).toBe(0);
  expect(
    buildingSound({ x: 30, y: 5, z: 0 }, { x: 0, y: 5, z: 0 }, [building])
      .strength,
  ).toBe(0.5);
  expect(
    buildingSound(
      { x: 30, y: 5, z: 0 },
      { x: -30, y: 5, z: 0 },
      Array(20).fill(building),
    ).gain,
  ).toBe(0.6);
});
