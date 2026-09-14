import { describe, expect, it } from "vitest";
import {
  ArrivalQueue,
  Experience,
  HEAVY,
  OBSERVERS,
  PRESETS,
  arrivalFor,
  compileRoute,
  createEmissions,
  distance,
  flightPose,
  presetRoute,
  selectRecipe,
  validRecipe,
} from "../packages/core/src";

describe("route compilation and flight", () => {
  for (const preset of PRESETS)
    it(`${preset.id}: deterministic closed route with bounded bank and altitude`, () => {
      const spec = presetRoute(preset.id),
        route = compileRoute(spec);
      expect(compileRoute(structuredClone(spec))).toEqual(route);
      expect(route.samples).toHaveLength(512);
      expect(route.durationMs).toBeGreaterThan(20000);
      expect(route.durationMs).toBeLessThan(300000);
      for (let t = 0; t < route.durationMs; t += 73) {
        const pose = flightPose(route, t);
        expect(Math.abs(pose.bankRad)).toBeLessThanOrEqual(HEAVY.maxBankRad);
        expect(pose.position.y).toBeGreaterThanOrEqual(
          HEAVY.minAltitudeM - 0.1,
        );
      }
      const start = flightPose(route, 0),
        end = flightPose(route, route.durationMs - 1);
      expect(distance(start.position, end.position)).toBeLessThan(0.1);
      expect(distance(start.tangent, end.tangent)).toBeLessThan(0.001);
      expect(flightPose(route, route.durationMs)).toEqual(start);
      expect(route.notices.some((n) => n.includes("置き換え"))).toBe(false);
    });
  it("moves at equal arc length speed, independent of frame rate", () => {
    const route = compileRoute(presetRoute("orbit"));
    for (let t = 0; t < route.durationMs; t += 1000) {
      const meters = distance(
        flightPose(route, t).position,
        flightPose(route, t + 100).position,
      );
      expect(meters).toBeCloseTo(HEAVY.speedMps * 0.1, 1);
    }
    expect(flightPose(route, 12345)).toEqual(
      flightPose(compileRoute(presetRoute("orbit")), 12345),
    );
  });
  it("rejects non-finite points and excessive input without mutating current route", () => {
    const e = new Experience(),
      before = e.route.checksum;
    expect(() =>
      e.setRoute({ ...e.spec, rawPoints: [{ x: NaN, y: 0, z: 0 }] }),
    ).toThrow();
    expect(e.route.checksum).toBe(before);
    expect(() =>
      compileRoute({
        ...e.spec,
        rawPoints: Array(1001).fill({ x: 0, y: 150, z: 0 }),
      }),
    ).toThrow();
  });
  it("substitutes a usable closed route for degenerate input", () => {
    const route = compileRoute({
      id: "short",
      revision: 2,
      closed: true,
      rawPoints: [{ x: 0, y: 0, z: 0 }],
    });
    expect(route.totalLengthM).toBeGreaterThan(2000);
    expect(route.notices.length).toBeGreaterThan(0);
  });
  it("rejects unsupported profiles before attempting fallback", () => {
    expect(() =>
      compileRoute(presetRoute("orbit"), { ...HEAVY, maxBankRad: NaN }),
    ).toThrow();
    expect(() =>
      compileRoute(presetRoute("orbit"), { ...HEAVY, speedMps: 10000 }),
    ).toThrow();
  });
  it("flattens sharp altitude changes across the closing seam", () => {
    const spec = presetRoute("orbit");
    spec.rawPoints[0].y = 9999;
    spec.rawPoints[1].y = -9999;
    const route = compileRoute(spec);
    route.samples.forEach((a, i, all) => {
      const b = all[(i + 1) % all.length];
      const slope =
        Math.abs(a.position.y - b.position.y) /
        Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
      expect(slope).toBeLessThanOrEqual(HEAVY.maxClimbGradient + 0.002);
    });
  });
});

describe("observer-specific sound propagation", () => {
  const emission = {
    id: 0,
    emitAtMs: 2000,
    position: { x: 343, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  };
  const origin = { x: 0, y: 0, z: 0 };
  it("arrives exactly one second later across 343 meters at physical scale", () => {
    expect(arrivalFor(emission, origin).arrivalAtMs).toBe(3000);
    expect(arrivalFor(emission, origin, 2).arrivalAtMs).toBe(4000);
    expect(arrivalFor(emission, { x: -343, y: 0, z: 0 }).arrivalAtMs).toBe(
      4000,
    );
  });
  it("does not play before emission or duplicate after moving away and back", () => {
    const queue = new ArrivalQueue([emission], 1);
    expect(queue.advance(1999, emission.position)).toEqual([]);
    expect(queue.advance(2999, origin)).toEqual([]);
    expect(queue.advance(3000, origin)).toHaveLength(1);
    expect(queue.advance(10000, { x: -3430, y: 0, z: 0 })).toEqual([]);
    expect(queue.remaining).toBe(0);
  });
  it("updates the arrival of pending emissions when the observer moves", () => {
    const queue = new ArrivalQueue([emission], 1);
    expect(queue.advance(2500, origin)).toHaveLength(0);
    expect(queue.advance(2500, { x: 343, y: 0, z: 0 })).toHaveLength(1);
  });
  it("bounds Doppler for approaching and receding sources", () => {
    expect(
      arrivalFor({ ...emission, velocity: { x: -150, y: 0, z: 0 } }, origin)
        .pitchRatio,
    ).toBe(1.35);
    expect(
      arrivalFor({ ...emission, velocity: { x: 300, y: 0, z: 0 } }, origin)
        .pitchRatio,
    ).toBe(0.75);
  });
  it("creates identical timestamped emission positions from identical routes", () => {
    const route = compileRoute(presetRoute("orbit"));
    const events = createEmissions(route, 1000);
    expect(events).toEqual(createEmissions(route, 1000));
    expect(events[events.length - 1].emitAtMs).toBeLessThan(
      1000 + route.durationMs,
    );
    expect(() => createEmissions(route, 0, 0)).toThrow();
  });
});

describe("single-user experience lifecycle", () => {
  it("flows through countdown, flight plus arrivals, tail and replay", () => {
    const e = new Experience();
    e.start(1);
    expect(e.phase).toBe("COMPILE");
    e.advance(2500);
    expect(e.phase).toBe("FLY");
    expect(e.arrivedCount).toBe(0);
    e.advance(20000);
    expect(e.arrivedCount).toBeGreaterThan(0);
    expect(e.phase).toBe("FLY");
    e.advance(e.route.durationMs - 20000);
    expect(e.phase).toBe("ARRIVAL");
    e.advance(60000);
    expect(e.phase).toBe("INTERLAP");
    expect(e.trails).toHaveLength(0);
    const previous = e.route.checksum;
    e.start(1, true);
    expect(e.lap).toBe(1);
    expect(e.recipe.id).toBe("deep-return");
    expect(e.route.checksum).toBe(previous);
  });
  it("pause freezes time and sound; editing cancels all future arrivals", () => {
    const e = new Experience();
    e.start();
    e.advance(20000);
    e.togglePause();
    const before = e.getSnapshot();
    e.advance(5000);
    expect(e.getSnapshot()).toEqual(before);
    e.togglePause();
    e.advance(1000);
    expect(e.nowMs).toBe(before.nowMs + 1000);
    e.edit();
    e.advance(60000);
    expect(e.arrivedCount).toBe(0);
    expect(e.trails).toEqual([]);
  });
  it("supports undo, preserves the active route, resets local state", () => {
    const e = new Experience(),
      first = e.route.checksum;
    e.setRoute(presetRoute("rise"));
    expect(e.route.checksum).not.toBe(first);
    e.undo();
    expect(e.route.checksum).toBe(first);
    e.start();
    e.setRoute(presetRoute("rise"));
    expect(e.route.checksum).toBe(first);
    e.setListener(OBSERVERS[1].position);
    e.reset();
    expect(e.phase).toBe("EDIT");
    expect(e.listener).toEqual(OBSERVERS[0].position);
    expect(e.canUndo).toBe(false);
  });
  it("caps trail and log storage during repeated use", () => {
    const e = new Experience();
    e.start();
    for (let i = 0; i < 2200; i++) {
      e.advance(50);
      e.log("sample");
      expect(e.trails.length).toBeLessThanOrEqual(128);
    }
    expect(e.logs.length).toBeLessThanOrEqual(2000);
  });
  it("allows only known bounded director recipes", () => {
    expect(validRecipe(selectRecipe(0))).toBe(true);
    expect(validRecipe({ ...selectRecipe(0), id: "execute-code" })).toBe(false);
    expect(validRecipe({ ...selectRecipe(0), delayScale: Infinity })).toBe(
      false,
    );
    const a = selectRecipe(0),
      b = selectRecipe(1);
    expect(a.lowFrequencyGain).not.toBe(b.lowFrequencyGain);
    expect(a.delayScale).toBe(b.delayScale);
    const e = new Experience();
    expect(() => e.start(NaN)).toThrow();
    expect(e.phase).toBe("EDIT");
  });
});
