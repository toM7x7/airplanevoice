import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSHOP,
  Experience,
  HEAVY,
  compileRoute,
  distance,
  flightPose,
  parseWorkshop,
  workshopSpec,
} from "../packages/core/src";

describe("workshop recipes", () => {
  it("round-trips one shared recipe format and rejects unknown or unsafe values", () => {
    expect(parseWorkshop(JSON.stringify(DEFAULT_WORKSHOP))).toEqual(
      DEFAULT_WORKSHOP,
    );
    for (const value of [
      null,
      [],
      { ...DEFAULT_WORKSHOP, version: 2 },
      { ...DEFAULT_WORKSHOP, execute: "anything" },
      {
        ...DEFAULT_WORKSHOP,
        aircraft: { ...DEFAULT_WORKSHOP.aircraft, engineCount: 8 },
      },
      { ...DEFAULT_WORKSHOP, route: { ...DEFAULT_WORKSHOP.route, seed: 0.5 } },
      {
        ...DEFAULT_WORKSHOP,
        flight: { ...DEFAULT_WORKSHOP.flight, speedMps: 900 },
      },
    ])
      expect(() => parseWorkshop(JSON.stringify(value))).toThrow();
    expect(() => parseWorkshop("function fly() {}")).toThrow();
    expect(() => parseWorkshop(" ".repeat(12001))).toThrow();
  });
  it("flies exactly through both anchors while retaining constant speed, slope and a closed seam", () => {
    for (const seed of [0, 7, 99, 2147483647]) {
      const recipe = structuredClone(DEFAULT_WORKSHOP);
      recipe.route.seed = seed;
      recipe.route.variation = 1;
      recipe.route.a = { x: -1300, z: -1900 };
      recipe.route.b = { x: 1000, z: -800 };
      const route = compileRoute(workshopSpec(recipe, 1));
      expect(route.durationMs).toBeLessThan(300000);
      expect(compileRoute(workshopSpec(recipe, 1))).toEqual(route);
      expect(
        distance(route.samples[0].position, {
          ...recipe.route.a,
          y: recipe.route.altitudeM,
        }),
      ).toBeLessThan(0.001);
      expect(
        distance(route.samples[256].position, {
          ...recipe.route.b,
          y: recipe.route.altitudeM,
        }),
      ).toBeLessThan(0.001);
      for (let t = 0; t < route.durationMs; t += 211) {
        const a = flightPose(route, t),
          b = flightPose(route, t + 100);
        expect(distance(a.position, b.position)).toBeCloseTo(
          recipe.flight.speedMps * 0.1,
          1,
        );
        expect(Math.abs(a.bankRad)).toBeLessThanOrEqual(HEAVY.maxBankRad);
        expect(
          Math.abs(a.tangent.y) / Math.hypot(a.tangent.x, a.tangent.z),
        ).toBeLessThan(HEAVY.maxClimbGradient);
      }
      expect(
        distance(
          flightPose(route, 0).position,
          flightPose(route, route.durationMs - 1).position,
        ),
      ).toBeLessThan(0.1);
      expect(
        Math.abs(
          flightPose(route, 0).bankRad -
            flightPose(route, route.durationMs - 1).bankRad,
        ),
      ).toBeLessThan(0.001);
    }
  });
  it("reproduces seeds and keeps anchors unchanged when variation changes", () => {
    const first = compileRoute(workshopSpec(DEFAULT_WORKSHOP, 1));
    const recipe = structuredClone(DEFAULT_WORKSHOP);
    recipe.route.seed++;
    const other = compileRoute(workshopSpec(recipe, 1));
    expect(first.checksum).not.toBe(other.checksum);
    expect(first.samples[128].position).not.toEqual(
      other.samples[128].position,
    );
    expect(
      distance(first.samples[0].position, other.samples[0].position),
    ).toBeLessThan(0.001);
    expect(
      distance(first.samples[256].position, other.samples[256].position),
    ).toBeLessThan(0.001);
  });
  it("keeps low-altitude variation within the flight profile and preserves anchor heights", () => {
    for (const seed of [0, 7, 99]) {
      const recipe = structuredClone(DEFAULT_WORKSHOP);
      recipe.route.seed = seed;
      recipe.route.altitudeM = 140;
      recipe.route.variation = 1;
      const profile = { ...HEAVY, maxClimbGradient: 0.01 };
      const route = compileRoute(workshopSpec(recipe, 1), profile);
      for (const sample of route.samples) {
        expect(sample.position.y).toBeGreaterThanOrEqual(profile.minAltitudeM);
        expect(sample.position.y).toBeLessThanOrEqual(profile.maxAltitudeM);
        expect(
          Math.abs(sample.tangent.y) /
            Math.hypot(sample.tangent.x, sample.tangent.z),
        ).toBeLessThanOrEqual(profile.maxClimbGradient + 1e-6);
      }
      expect(route.samples[0].position.y).toBeCloseTo(140, 6);
      expect(route.samples[256].position.y).toBeCloseTo(140, 6);
    }
    expect(() =>
      compileRoute(workshopSpec(DEFAULT_WORKSHOP, 1), {
        ...HEAVY,
        minAltitudeM: 300,
      }),
    ).toThrow();
  });
  it("slows the roll response without moving the aircraft or changing its sound schedule", () => {
    const recipe = structuredClone(DEFAULT_WORKSHOP);
    recipe.route.variation = 1;
    const slow = compileRoute(workshopSpec(recipe, 1));
    const direct = { ...slow, bankResponseSec: 0 };
    const t = slow.durationMs * 0.19;
    expect(flightPose(slow, t).position).toEqual(
      flightPose(direct, t).position,
    );
    expect(
      Math.abs(flightPose(slow, t).bankRad - flightPose(direct, t).bankRad),
    ).toBeGreaterThan(0.0001);
    const rate = (r: typeof slow) =>
      Math.max(
        ...Array.from({ length: 300 }, (_, i) =>
          Math.abs(
            flightPose(r, (i / 300) * r.durationMs + 100).bankRad -
              flightPose(r, (i / 300) * r.durationMs).bankRad,
          ),
        ),
      );
    expect(rate(slow)).toBeLessThanOrEqual(rate(direct) * 1.01);
  });
  it("applies aircraft and route together, keeps the previous state on rejection, and locks during flight", () => {
    const e = new Experience(),
      before = e.getSnapshot();
    const bad = structuredClone(DEFAULT_WORKSHOP);
    bad.route.b = { ...bad.route.a };
    bad.aircraft.engineCount = 2;
    expect(() => e.applyWorkshop(bad)).toThrow();
    expect(e.getSnapshot()).toEqual(before);
    const good = structuredClone(DEFAULT_WORKSHOP);
    good.aircraft.engineCount = 2;
    e.applyWorkshop(good);
    expect(e.aircraftDesign.engineCount).toBe(2);
    expect(e.spec.generator?.seed).toBe(7);
    const checksum = e.route.checksum;
    e.start();
    e.applyWorkshop(DEFAULT_WORKSHOP);
    e.setAircraftDesign(DEFAULT_WORKSHOP.aircraft);
    expect(e.route.checksum).toBe(checksum);
    expect(e.aircraftDesign.engineCount).toBe(2);
    e.reset();
    expect(e.aircraftDesign.engineCount).toBe(4);
    expect(e.spec.generator).toBeUndefined();
  });
});
