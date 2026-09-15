import { describe, expect, it } from "vitest";
import { Experience, aircraftInfo, compassHeading } from "../packages/core/src";

describe("aircraft observation", () => {
  it("uses world north and clockwise headings, independent of camera bearing", () => {
    for (const [x, z, degrees, label] of [
      [0, -1, 0, "北"],
      [1, 0, 90, "東"],
      [0, 1, 180, "南"],
      [-1, 0, 270, "西"],
      [1, -1, 45, "北東"],
    ] as const) {
      expect(compassHeading({ x, y: 0.2, z })).toEqual({ degrees, label });
    }
    const heading = compassHeading({ x: -0.001, y: 0, z: -1 });
    expect(heading.degrees).toBeGreaterThan(359);
    expect(heading.label).toBe("北");
  });
  it("reads each flight without changing time, routes, listening or pause state", () => {
    const e = new Experience();
    e.setAirspace({ aircraftCount: 3, spacingSec: 16 });
    expect(aircraftInfo(e, "ST-01")?.state).toBe("preview");
    expect(aircraftInfo(e, "ST-02")?.visible).toBe(false);
    e.start();
    e.advance(20000);
    const before = e.getSnapshot();
    const a = aircraftInfo(e, "ST-01")!,
      b = aircraftInfo(e, "ST-02")!;
    expect(a.state).toBe("flying");
    expect(b.state).toBe("flying");
    expect(a.speedMps).toBe(58);
    expect(b.speedMps).toBe(58);
    expect(a.headingDeg).not.toBe(b.headingDeg);
    expect(b.altitudeM! - a.altitudeM!).toBeCloseTo(85);
    expect(e.getSnapshot()).toEqual(before);
    e.togglePause();
    const paused = aircraftInfo(e, "ST-02");
    e.advance(2000);
    expect(aircraftInfo(e, "ST-02")).toEqual(paused);
    expect(paused?.paused).toBe(true);
  });
  it("does not show invented positions for waiting, finished or removed aircraft", () => {
    const e = new Experience();
    e.setAirspace({ aircraftCount: 2, spacingSec: 16 });
    e.start();
    expect(aircraftInfo(e, "ST-02")?.speedMps).toBeNull();
    e.advance(2500 + e.route.durationMs + 1);
    const done = aircraftInfo(e, "ST-01")!;
    expect(["tail", "complete"]).toContain(done.state);
    expect(done.headingDeg).toBeNull();
    expect(done.altitudeM).toBeNull();
    expect(aircraftInfo(e, "ST-02")?.visible).toBe(true);
    e.reset();
    expect(aircraftInfo(e, "ST-02")).toBeNull();
  });
});
