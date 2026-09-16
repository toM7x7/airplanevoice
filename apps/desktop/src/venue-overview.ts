import type { VenueMap } from "../../../packages/core/src/venue";

/** Drawing coordinates only. Includes the table origin; +X right, -Z up. */
export function venueOverviewLayout(venue: VenueMap) {
  const xs = [0, ...venue.points.map((p) => p.x)];
  const zs = [0, ...venue.points.map((p) => p.z)];
  const minX = Math.min(...xs) - 1,
    maxX = Math.max(...xs) + 1;
  const minZ = Math.min(...zs) - 1,
    maxZ = Math.max(...zs) + 1;
  const pixelsPerM = Math.min(880 / (maxX - minX), 400 / (maxZ - minZ));
  const cx = (minX + maxX) / 2,
    cz = (minZ + maxZ) / 2;
  const project = (x: number, z: number) => ({
    x: 512 + (x - cx) * pixelsPerM,
    y: 332 + (z - cz) * pixelsPerM,
  });
  return {
    pixelsPerM,
    // The board is 1.2 m wide and its texture is 1024 px wide.
    scale: (pixelsPerM * 1.2) / 1024,
    origin: project(0, 0),
    points: venue.points.map((p) => ({ ...p, drawing: project(p.x, p.z) })),
  };
}
