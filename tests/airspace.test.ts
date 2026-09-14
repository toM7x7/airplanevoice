import { describe, expect, it } from "vitest";
import {
  AIRCRAFT,
  Experience,
  TowerDirector,
  buildAirspace,
  compileRoute,
  distance,
  presetRoute,
  soundMix,
  type AirspaceConfig,
  type FlightArrival,
} from "../packages/core/src";

describe("local airspace", () => {
  it("keeps the authored flight and creates deterministic translated lanes with staggered starts", () => {
    const route = compileRoute(presetRoute("orbit"));
    const a = buildAirspace(
      route,
      2500,
      { aircraftCount: 3, spacingSec: 16 },
      1.6,
    );
    const b = buildAirspace(
      route,
      2500,
      { aircraftCount: 3, spacingSec: 16 },
      1.6,
    );
    expect(a[0].route).toBe(route);
    expect(a.map((f) => f.startAtMs)).toEqual([2500, 18500, 34500]);
    expect(a.map((f) => f.route.checksum)).toEqual(
      b.map((f) => f.route.checksum),
    );
    expect(new Set(a.map((f) => f.route.checksum)).size).toBe(3);
    expect(a.every((f) => f.route.durationMs === route.durationMs)).toBe(true);
    expect(
      distance(a[0].route.samples[0].position, a[1].route.samples[0].position),
    ).toBeGreaterThan(600);
    expect(a[1].queue.advance(18499, { x: 0, y: 0, z: 0 })).toEqual([]);
  });
  it("keeps comparison lanes inside the altitude ceiling", () => {
    const route = compileRoute(presetRoute("orbit", 1, 640));
    const flights = buildAirspace(
      route,
      0,
      { aircraftCount: 3, spacingSec: 0 },
      1,
    );
    for (const f of flights)
      expect(
        Math.max(...f.route.samples.map((s) => s.position.y)),
      ).toBeLessThanOrEqual(650);
  });
  it("tracks every aircraft, keeps sound identities unique, and waits for every tail", () => {
    const e = new Experience();
    e.setAirspace({ aircraftCount: 3, spacingSec: 16 });
    const heard: FlightArrival[] = [];
    e.onArrival = (arrival) => heard.push(arrival);
    e.start(3);
    e.advance(2500 + e.route.durationMs);
    expect(e.phase).toBe("FLY");
    expect(e.getSnapshot().fleet[0].state).not.toBe("flying");
    expect(e.getSnapshot().fleet[2].state).toBe("flying");
    e.advance(32000);
    expect(e.phase).toBe("ARRIVAL");
    expect(e.getSnapshot().pendingCount).toBeGreaterThan(0);
    e.advance(60000);
    expect(e.phase).toBe("INTERLAP");
    expect(
      e
        .getSnapshot()
        .fleet.every(
          (f) =>
            f.state === "complete" &&
            f.pendingCount === 0 &&
            f.arrivedCount > 0,
        ),
    ).toBe(true);
    expect(
      new Set(heard.map((a) => `${a.flightId}/${a.emission.id}`)).size,
    ).toBe(heard.length);
    expect(
      new Set(heard.filter((a) => a.emission.id === 0).map((a) => a.flightId))
        .size,
    ).toBe(3);
    expect(heard.every((a) => a.arrivalAtMs >= a.emission.emitAtMs)).toBe(true);
  });
  it("locks flight configuration but allows listening changes without changing flight or sound time", () => {
    const e = new Experience();
    e.setAirspace({ aircraftCount: 3, spacingSec: 8 });
    e.start();
    e.advance(26000);
    const before = e.getSnapshot();
    e.setAirspace({ aircraftCount: 1, spacingSec: 0 });
    e.setMix("focus", "ST-03");
    const after = e.getSnapshot();
    expect(after.fleet).toEqual(before.fleet);
    expect(after.pendingCount).toBe(before.pendingCount);
    expect(after.airspace).toEqual(before.airspace);
    e.togglePause();
    const frozen = e.getSnapshot();
    e.advance(60000);
    expect(e.getSnapshot()).toEqual(frozen);
    e.reset();
    expect(e.airspace.aircraftCount).toBe(1);
    expect(e.focusId).toBe("ST-01");
    expect(e.tower.enabled).toBe(false);
    expect(e.flights).toEqual([]);
  });
  it("retains settings on replay, bounds trails, and clears all queues on edit", () => {
    const e = new Experience();
    e.setAirspace({ aircraftCount: 3, spacingSec: 0 });
    e.start();
    for (let i = 0; i < 1250; i++) {
      e.advance(100);
      expect(e.trails.length).toBeLessThanOrEqual(384);
    }
    expect(e.phase).toBe("INTERLAP");
    e.start(1.6, true);
    expect(e.flights).toHaveLength(3);
    expect(e.lap).toBe(1);
    expect(e.flights.every((f) => f.arrivedCount === 0)).toBe(true);
    e.edit();
    e.advance(10000);
    expect(e.arrivedCount).toBe(0);
    expect(e.trails).toEqual([]);
    expect(e.getSnapshot().pendingCount).toBe(0);
    e.setMix("focus", "ST-03");
    e.setAirspace({ aircraftCount: 1, spacingSec: 8 });
    expect(e.focusId).toBe("ST-01");
  });
  it("rejects malformed settings before mutation", () => {
    const e = new Experience();
    expect(() =>
      e.setAirspace({
        aircraftCount: 50,
        spacingSec: -8,
      } as unknown as AirspaceConfig),
    ).toThrow();
    expect(e.airspace).toEqual({ aircraftCount: 1, spacingSec: 8 });
    expect(() => e.setMix("focus", "ST-03")).toThrow();
    expect(e.focusId).toBe("ST-01");
  });
});

describe("listener mix", () => {
  it("bounds summed squared weights and preserves background audibility", () => {
    const ids = AIRCRAFT.map((a) => a.id);
    for (const mode of ["focus", "balanced"] as const)
      for (const focus of ids) {
        const gains = soundMix(ids, mode, focus);
        expect(
          Object.values(gains).reduce((sum, gain) => sum + gain * gain, 0),
        ).toBeCloseTo(1, 10);
        expect(
          Object.values(gains).every((gain) => gain > 0 && gain <= 1),
        ).toBe(true);
      }
    const focused = soundMix(ids, "focus", "ST-02");
    expect(focused["ST-02"]! / focused["ST-01"]!).toBeCloseTo(1 / 0.24);
    const balanced = soundMix(ids, "balanced", "ST-02");
    expect(balanced["ST-01"]).toBe(balanced["ST-03"]);
    expect(soundMix(["ST-01"], "focus", "ST-01")).toEqual({ "ST-01": 1 });
  });
});

describe("tower captions", () => {
  it("is opt-in, prioritizes the schedule, and leaves intervals between captions", () => {
    const tower = new TowerDirector();
    tower.accept({ type: "started", atMs: 0, flightId: "ST-01" });
    tower.advance(0, false);
    expect(tower.cue).toBeNull();
    tower.setEnabled(true);
    tower.accept({ type: "started", atMs: 0, flightId: "ST-01" });
    tower.accept({ type: "scheduled", atMs: 0, count: 3, spacingSec: 8 });
    tower.advance(0, false);
    expect(tower.cue?.fact.type).toBe("scheduled");
    tower.accept({ type: "started", atMs: 6000, flightId: "ST-02" });
    tower.advance(6000, false);
    expect(tower.cue).toBeNull();
    tower.advance(8000, false);
    expect(tower.cue?.fact.flightId).toBe("ST-02");
  });
  it("yields to a close pass, drops expired facts, and never replays them on enabling", () => {
    const tower = new TowerDirector();
    tower.setEnabled(true);
    tower.accept({ type: "started", atMs: 0, flightId: "ST-01" });
    tower.advance(0, false);
    expect(tower.cue).not.toBeNull();
    tower.advance(1000, true);
    expect(tower.cue).toBeNull();
    tower.accept({ type: "first-arrival", atMs: 2000, flightId: "ST-01" });
    tower.advance(2000, true);
    tower.advance(10000, false);
    expect(tower.cue).toBeNull();
    tower.accept({ type: "clear", atMs: 10000 });
    tower.advance(10000, false);
    expect(tower.cue?.fact.type).toBe("clear");
    tower.setEnabled(false);
    tower.setEnabled(true);
    tower.advance(18000, false);
    expect(tower.cue).toBeNull();
  });
});
