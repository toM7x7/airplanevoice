import type { EnvironmentObject } from "./environment";
import type { Vec3 } from "./types";

/** Cheap direct-path coloration, not reflection/diffraction or an acoustic solver. */
export function buildingSound(
  source: Vec3,
  listener: Vec3,
  buildings: EnvironmentObject[],
) {
  let thickness = 0;
  const distance = Math.hypot(
    source.x - listener.x,
    source.y - listener.y,
    source.z - listener.z,
  );
  for (const b of buildings) {
    let enter = 0,
      exit = 1;
    const min = { x: b.x - b.width / 2, y: 0, z: b.z - b.depth / 2 },
      max = { x: b.x + b.width / 2, y: b.height, z: b.z + b.depth / 2 };
    for (const axis of ["x", "y", "z"] as const) {
      const delta = source[axis] - listener[axis];
      if (Math.abs(delta) < 1e-8) {
        if (listener[axis] < min[axis] || listener[axis] > max[axis]) exit = -1;
      } else {
        const a = (min[axis] - listener[axis]) / delta,
          c = (max[axis] - listener[axis]) / delta;
        enter = Math.max(enter, Math.min(a, c));
        exit = Math.min(exit, Math.max(a, c));
      }
      if (exit <= enter) break;
    }
    if (exit > enter) thickness += (exit - enter) * distance;
    if (thickness >= 12) break;
  }
  const strength = Math.min(1, thickness / 12);
  return {
    strength,
    gain: 1 - 0.4 * strength,
    cutoffHz: 1800 - 1000 * strength,
  };
}
