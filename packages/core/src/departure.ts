import { flightPose } from "./flight";
import { normalize } from "./math";
import type { CompiledRoute, Vec3 } from "./types";
export const DEPARTURE_MS = 33000;

/** Authored runway roll and climb, driven by shared time; not an aerodynamic simulation. */
export function withRunwayDeparture(
  route: CompiledRoute,
  laps = 1,
): CompiledRoute {
  const join = flightPose(route, 0);
  const position = (ms: number): Vec3 => {
    if (ms < 8000) {
      const t = Math.max(0, ms) / 1000;
      return { x: -200 + 4.4 * t * t, y: 8.5, z: -180 };
    }
    if (ms >= DEPARTURE_MS)
      return flightPose(route, ms - DEPARTURE_MS).position;
    const t = (ms - 8000) / 25000,
      t2 = t * t,
      t3 = t2 * t;
    const start = { x: 81.6, y: 8.5, z: -180 };
    const velocity = { x: 70.4, y: 0, z: 0 };
    const result = { x: 0, y: 0, z: 0 };
    for (const axis of ["x", "y", "z"] as const)
      result[axis] =
        (2 * t3 - 3 * t2 + 1) * start[axis] +
        (t3 - 2 * t2 + t) * 25 * velocity[axis] +
        (-2 * t3 + 3 * t2) * join.position[axis] +
        (t3 - t2) * 25 * route.speedMps * join.tangent[axis];
    return result;
  };
  const durationMs = route.durationMs * laps + DEPARTURE_MS,
    count = Math.ceil(durationMs / 100);
  let length = 0;
  const samples = Array.from({ length: count }, (_, i) => {
    const ms = (i / count) * durationMs,
      p = position(ms),
      prev = position(Math.max(0, ms - 50)),
      next = position(ms + 50);
    if (i) {
      const before = position(((i - 1) / count) * durationMs);
      length += Math.hypot(p.x - before.x, p.y - before.y, p.z - before.z);
    }
    const tangent =
      ms < 1
        ? { x: 1, y: 0, z: 0 }
        : normalize({
            x: next.x - prev.x,
            y: next.y - prev.y,
            z: next.z - prev.z,
          });
    const sample =
      route.samples[
        Math.floor(
          (Math.max(0, ms - DEPARTURE_MS) / route.durationMs) *
            route.samples.length,
        ) % route.samples.length
      ];
    return {
      position: p,
      tangent,
      curvature: ms < DEPARTURE_MS ? 0 : sample.curvature,
      sM: length,
    };
  });
  return {
    ...route,
    samples,
    durationMs,
    totalLengthM: length,
    checksum: `${route.checksum}/runway-v1${laps === 1 ? "" : `/laps-${laps}`}`,
  };
}
