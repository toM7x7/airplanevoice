import { describe, expect, it } from "vitest";
import {
  alignedPoint,
  DEFAULT_TABLE,
  rotateY,
  solveAlignment,
} from "./spatial-alignment";
import { checkedVenue, DEFAULT_VENUE } from "./venue";
import { changeRoom, newRoom } from "./shared-room";

describe("shared physical coordinates", () => {
  it("aligns opposite-facing devices without scaling head movement", () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -0.71]) {
      const a = { x: 2, y: 0.82, z: -3 };
      const d = rotateY({ x: 0.6, y: 0, z: 0 }, -yaw);
      const b = { x: a.x + d.x, y: a.y, z: a.z + d.z };
      const alignment = solveAlignment(a, b, DEFAULT_TABLE);
      const pa = alignedPoint(a, alignment),
        pb = alignedPoint(b, alignment);
      expect(pa.x).toBeCloseTo(0);
      expect(pa.y).toBeCloseTo(0.75);
      expect(pa.z).toBeCloseTo(0);
      expect(pb.x).toBeCloseTo(0.6);
      expect(pb.z).toBeCloseTo(0);
      const c = rotateY({ x: 0, y: 0.9, z: -0.6 }, -yaw);
      const pc = alignedPoint(
        { x: a.x + c.x, y: a.y + c.y, z: a.z + c.z },
        alignment,
      );
      expect(pc.y).toBeCloseTo(1.65);
      expect(pc.z).toBeCloseTo(-0.6);
    }
  });
  it("rejects coincident, wrong-scale, tilted and nonfinite captures", () => {
    const a = { x: 0, y: 0.75, z: 0 };
    for (const b of [
      a,
      { x: 1.2, y: 0.75, z: 0 },
      { x: 0.6, y: 1, z: 0 },
      { x: NaN, y: 0.75, z: 0 },
    ])
      expect(() => solveAlignment(a, b, DEFAULT_TABLE)).toThrow();
  });
  it("persists a venue through room operations without changing the active flight", () => {
    const launched = changeRoom(
      newRoom(1000),
      { id: "launch-test", revision: 0, type: "launch" },
      1000,
    );
    const venue = structuredClone(DEFAULT_VENUE);
    venue.selectedId = "booth-2";
    const next = changeRoom(
      launched,
      { id: "venue-test", revision: 1, type: "venue", venue },
      5000,
    );
    expect(next.flights).toEqual(launched.flights);
    expect(next.venue).toEqual(venue);
    expect(() =>
      changeRoom(
        next,
        { id: "stale-test", revision: 1, type: "venue", venue },
        6000,
      ),
    ).toThrow();
  });
  it("rejects invalid maps and does not retain untrusted extra fields", () => {
    for (const patch of [
      { points: [] },
      {
        points: Array.from({ length: 5 }, (_, i) => ({
          ...DEFAULT_VENUE.points[0],
          id: `booth-${i}`,
        })),
      },
      { baselineM: 0 },
      { selectedId: "missing" },
      { points: [DEFAULT_VENUE.points[0], DEFAULT_VENUE.points[0]] },
      { points: [{ ...DEFAULT_VENUE.points[0], x: Infinity }] },
    ])
      expect(() => checkedVenue({ ...DEFAULT_VENUE, ...patch })).toThrow();
    expect(checkedVenue({ ...DEFAULT_VENUE, secret: "extra" })).toEqual(
      DEFAULT_VENUE,
    );
  });
});
