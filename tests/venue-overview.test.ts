import { describe, expect, it } from "vitest";
import { venueOverviewLayout } from "../apps/desktop/src/venue-overview";
import { DEFAULT_VENUE } from "../packages/core/src/venue";

describe("venue overview presentation", () => {
  it("fits the origin and opposite venue corners without changing the shared metre coordinates", () => {
    const venue = structuredClone(DEFAULT_VENUE);
    venue.points[0].x = -25;
    venue.points[0].z = -25;
    venue.points[1].x = 25;
    venue.points[1].z = 25;
    const original = structuredClone(venue);
    const map = venueOverviewLayout(venue);
    for (const p of [map.origin, ...map.points.map((p) => p.drawing)]) {
      expect(p.x).toBeGreaterThan(42);
      expect(p.x).toBeLessThan(982);
      expect(p.y).toBeGreaterThan(122);
      expect(p.y).toBeLessThan(542);
    }
    expect(venue).toEqual(original);
    expect(map.points[0].drawing.x).toBeLessThan(map.points[1].drawing.x);
    expect(map.points[0].drawing.y).toBeLessThan(map.points[1].drawing.y);
    expect(map.scale).toBeGreaterThan(0);
    expect(map.scale).toBeLessThan(1);
  });
  it("uses one scale on both axes, including coincident points and the origin", () => {
    const venue = {
      ...DEFAULT_VENUE,
      points: [
        { id: "a", name: "A", x: 0, z: 0 },
        { id: "b", name: "B", x: 2, z: -2 },
      ],
    };
    const map = venueOverviewLayout(venue);
    expect(map.points[0].drawing).toEqual(map.origin);
    expect(map.points[1].drawing.x - map.origin.x).toBeCloseTo(
      map.origin.y - map.points[1].drawing.y,
    );
    const one = venueOverviewLayout({ ...venue, points: [venue.points[0]] });
    expect(Number.isFinite(one.scale)).toBe(true);
  });
});
