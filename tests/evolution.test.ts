import { describe, expect, it } from "vitest";
import {
  Experience,
  evolveRoute,
  EVOLUTION_REST_MS,
  presetRoute,
  compileRoute,
  DEFAULT_WORKSHOP,
  workshopSpec,
  PRESETS,
} from "../packages/core/src";

function finish(e: Experience) {
  e.advance(Math.max(0, e.startAtMs + e.durationMs - e.nowMs));
  while (e.phase !== "INTERLAP") e.advance(50);
}

describe("evolving flight sequences", () => {
  it("derives nearby, bounded variants from the original, preserving speed and input", () => {
    for (const preset of PRESETS) {
      const base = presetRoute(preset.id),
        saved = structuredClone(base);
      let previous = base;
      const hashes = new Set<string>();
      for (let lap = 0; lap < 120; lap++) {
        const spec = evolveRoute(base, lap, 0.65);
        const route = compileRoute(spec);
        hashes.add(route.checksum);
        expect(route.speedMps).toBe(58);
        expect(route.notices.some((n) => n.includes("置き換え"))).toBe(false);
        spec.rawPoints.forEach((p, i) => {
          const origin = base.rawPoints[i],
            prev = previous.rawPoints[i];
          expect(Math.hypot(p.x - origin.x, p.z - origin.z)).toBeLessThan(400);
          expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeLessThan(150);
          expect(Math.abs(p.y - origin.y)).toBeLessThanOrEqual(35);
        });
        previous = spec;
      }
      expect(hashes.size).toBeGreaterThan(115);
      expect(base).toEqual(saved);
      expect(evolveRoute(base, 37, 0.65)).toEqual(evolveRoute(saved, 37, 0.65));
      expect(evolveRoute(base, 10, 0)).toEqual(base);
    }
  });
  it("preserves the two-point constraints and reproduces generated variations", () => {
    const base = workshopSpec(DEFAULT_WORKSHOP, 0);
    const hashes = new Set<string>();
    for (let lap = 0; lap < 80; lap++) {
      const spec = evolveRoute(base, lap, 1);
      expect(spec.generator!.a).toEqual(base.generator!.a);
      expect(spec.generator!.b).toEqual(base.generator!.b);
      expect(spec.generator!.altitudeM).toBe(base.generator!.altitudeM);
      const route = compileRoute(spec);
      hashes.add(route.checksum);
      expect(
        route.samples.every(
          (s) =>
            Math.abs(s.position.x) <= 6000 && Math.abs(s.position.z) <= 6000,
        ),
      ).toBe(true);
    }
    expect(hashes.size).toBeGreaterThan(60);
  });
  it("waits for all aircraft and arrivals, then starts exactly one next lap", () => {
    const e = new Experience(),
      original = e.route.checksum;
    e.setAirspace({ aircraftCount: 3, spacingSec: 16 });
    e.setEvolution({ enabled: true, amount: 0.65 });
    e.start();
    e.advance(e.route.durationMs + 2500);
    expect(e.lap).toBe(0);
    expect(e.route.checksum).toBe(original);
    expect(e.flights[2].ended).toBe(false);
    finish(e);
    expect(e.flights.every((f) => f.ended && f.queue.remaining === 0)).toBe(
      true,
    );
    expect(e.getSnapshot().evolution.nextInSec).toBe(6);
    e.advance(EVOLUTION_REST_MS - 1);
    expect(e.lap).toBe(0);
    e.advance(1);
    expect(e.lap).toBe(1);
    expect(e.phase).toBe("COMPILE");
    expect(e.route.checksum).not.toBe(original);
    expect(e.flights.every((f) => !f.started)).toBe(true);
    expect(e.getSnapshot().pendingCount).toBeGreaterThan(0);
  });
  it("pauses the rest period, cancels continuation, and never changes a live route", () => {
    const e = new Experience();
    e.setEvolution({ enabled: true, amount: 0.65 });
    e.start();
    e.advance(4000);
    const flying = e.route;
    e.setEvolution({ enabled: true, amount: 1 });
    expect(e.route).toBe(flying);
    finish(e);
    e.advance(1000);
    e.togglePause();
    const paused = e.getSnapshot();
    e.advance(60000);
    expect(e.getSnapshot()).toEqual(paused);
    e.setEvolution({ enabled: false, amount: 1 });
    e.togglePause();
    e.advance(60000);
    expect(e.phase).toBe("INTERLAP");
    expect(e.lap).toBe(0);
    expect(e.route).toBe(flying);
    e.setEvolution({ enabled: true, amount: 1 });
    expect(e.getSnapshot().evolution.nextInSec).toBe(6);
    e.advance(6000);
    expect(e.lap).toBe(1);
  });
  it("restores the original on edit, or keeps a chosen variant with undo", () => {
    const e = new Experience(),
      original = structuredClone(e.spec);
    e.setEvolution({ enabled: true, amount: 1 });
    e.start();
    finish(e);
    e.advance(6000);
    expect(e.spec).not.toEqual(original);
    e.edit();
    expect(e.spec).toEqual(original);
    expect(e.getSnapshot().evolution.nextInSec).toBeNull();
    e.start();
    finish(e);
    e.advance(6000);
    const chosen = structuredClone(e.spec);
    e.edit(true);
    expect(e.spec).toEqual(chosen);
    expect(e.getSnapshot().evolution.baseChecksum).toBeNull();
    e.undo();
    expect(e.spec).toEqual(original);
    e.reset();
    expect(e.evolution.enabled).toBe(false);
  });
  it("keeps all rolling state bounded through many complete laps", () => {
    const e = new Experience();
    e.setEvolution({ enabled: true, amount: 0.65 });
    e.start();
    for (let lap = 0; lap < 35; lap++) {
      finish(e);
      e.advance(6000);
      expect(e.lap).toBe(lap + 1);
      expect(e.flights).toHaveLength(1);
      expect(e.trails.length).toBeLessThanOrEqual(128);
      expect(e.logs.length).toBeLessThanOrEqual(2000);
      expect(e.canUndo).toBe(false);
    }
  });
  it("rejects invalid settings without modifying a running experience", () => {
    const e = new Experience();
    e.start();
    const state = e.getSnapshot();
    expect(() => e.setEvolution({ enabled: true, amount: NaN })).toThrow();
    expect(e.getSnapshot()).toEqual(state);
    expect(() => evolveRoute(e.spec, -1, 0.5)).toThrow();
    expect(() => evolveRoute(e.spec, 1, 2)).toThrow();
  });
  it("stops unattended generation when a tiny drawn route needs replacement", () => {
    const e = new Experience();
    e.setRoute({
      id: "drawn",
      revision: 0,
      closed: true,
      rawPoints: [0, 20, 40, 60].map((x) => ({ x, y: 240, z: -1000 })),
    });
    const valid = e.route;
    e.setEvolution({ enabled: true, amount: 1 });
    e.start();
    finish(e);
    e.advance(6000);
    expect(e.phase).toBe("INTERLAP");
    expect(e.lap).toBe(0);
    expect(e.evolution.enabled).toBe(false);
    expect(e.getSnapshot().evolution.error).toBeTruthy();
    expect(e.route).toBe(valid);
    expect(e.getSnapshot().evolution.nextInSec).toBeNull();
    e.advance(60000);
    expect(e.route).toBe(valid);
  });
});
