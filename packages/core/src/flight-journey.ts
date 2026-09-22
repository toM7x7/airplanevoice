import { withRunwayDeparture, DEPARTURE_MS } from "./departure";
import { flightPose } from "./flight";
import { normalize, checksum } from "./math";
import type { CompiledRoute, Vec3 } from "./types";

export const ARRIVAL_MS = 140000;
export interface FlightInstruction {
  id: string;
  kind: "overhead" | "wide" | "higher";
  fromMs: number;
  untilMs: number;
  offset: Vec3;
}
function hermite(
  a: Vec3,
  b: Vec3,
  va: Vec3,
  vb: Vec3,
  seconds: number,
  t: number,
): Vec3 {
  const p = { x: 0, y: 0, z: 0 },
    t2 = t * t,
    t3 = t2 * t;
  for (const k of ["x", "y", "z"] as const)
    p[k] =
      (2 * t3 - 3 * t2 + 1) * a[k] +
      (t3 - 2 * t2 + t) * seconds * va[k] +
      (-2 * t3 + 3 * t2) * b[k] +
      (t3 - t2) * seconds * vb[k];
  return p;
}
/** Versioned, deterministic animation. Old runway-v1 flights keep their old compiler. */
export function flightJourney(
  base: CompiledRoute,
  laps = 2,
  landingDelayMs = 0,
): CompiledRoute {
  const motionBase = { ...base, bankResponseSec: 0 };
  const departure = withRunwayDeparture(motionBase, laps),
    cruiseEnd = departure.durationMs + landingDelayMs;
  const join = flightPose(motionBase, landingDelayMs),
    velocity = {
      x: join.tangent.x * base.speedMps,
      y: join.tangent.y * base.speedMps,
      z: join.tangent.z * base.speedMps,
    };
  const position = (ms: number): Vec3 => {
    if (ms < cruiseEnd)
      return ms < DEPARTURE_MS
        ? flightPose(departure, ms).position
        : flightPose(motionBase, ms - DEPARTURE_MS).position;
    const elapsed = (ms - cruiseEnd) / 1000;
    if (elapsed < 80)
      return hermite(
        join.position,
        { x: -950, y: 8.5, z: -180 },
        velocity,
        { x: 52, y: 0, z: 0 },
        80,
        elapsed / 80,
      );
    if (elapsed < 105) {
      const t = elapsed - 80;
      return { x: -950 + 52 * t - 0.88 * t * t, y: 8.5, z: -180 };
    }
    return hermite(
      { x: -200, y: 8.5, z: -180 },
      { x: -120, y: 8.5, z: -350 },
      { x: 8, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      35,
      Math.min(1, (elapsed - 105) / 35),
    );
  };
  const durationMs = cruiseEnd + ARRIVAL_MS,
    count = Math.ceil(durationMs / 100) + 1;
  let length = 0,
    previous = position(0);
  const samples = Array.from({ length: count }, (_, i) => {
    const ms = (i / (count - 1)) * durationMs,
      p = position(ms),
      before = position(Math.max(0, ms - 50)),
      after = position(Math.min(durationMs, ms + 50));
    length += Math.hypot(p.x - previous.x, p.y - previous.y, p.z - previous.z);
    previous = p;
    return {
      position: p,
      tangent: normalize({
        x: after.x - before.x,
        y: after.y - before.y,
        z: after.z - before.z,
      }),
      sM: length,
      curvature:
        ms >= DEPARTURE_MS && ms < cruiseEnd
          ? base.samples[
              Math.floor(
                (((ms - DEPARTURE_MS) % base.durationMs) / base.durationMs) *
                  base.samples.length,
              )
            ].curvature
          : 0,
    };
  });
  return {
    ...base,
    loop: false,
    durationMs,
    totalLengthM: length,
    samples,
    checksum: `${base.checksum}/journey-v2/laps-${laps}${landingDelayMs ? `/hold-${landingDelayMs}` : ""}`,
  };
}
/** Smooth, finite route detours; the original path before the command and after it stays unchanged. */
export function instructedRoute(
  route: CompiledRoute,
  instructions: FlightInstruction[] = [],
): CompiledRoute {
  if (!instructions.length) return route;
  const step =
    route.durationMs / (route.samples.length - (route.loop === false ? 1 : 0));
  const points = route.samples.map((s, i) => {
    const p = { ...s.position },
      ms = i * step;
    for (const command of instructions) {
      if (ms <= command.fromMs || ms >= command.untilMs) continue;
      const t = (ms - command.fromMs) / (command.untilMs - command.fromMs);
      // Fourth power gives zero acceleration as well as zero velocity at both joins.
      const weight = Math.sin(Math.PI * t) ** 4;
      for (const axis of ["x", "y", "z"] as const)
        p[axis] += command.offset[axis] * weight;
    }
    return p;
  });
  let length = 0;
  const samples = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)],
      b = points[Math.min(points.length - 1, i + 1)];
    length += Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z);
    if (
      !instructions.some((c) => i * step >= c.fromMs && i * step <= c.untilMs)
    )
      return { ...route.samples[i], sM: length };
    const tangent = normalize({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
    const dx = p.x - a.x,
      dz = p.z - a.z,
      ex = b.x - p.x,
      ez = b.z - p.z;
    const curvature =
      (dz * ex - dx * ez) /
      Math.max(
        1,
        (Math.hypot(dx, dz) *
          Math.hypot(ex, ez) *
          Math.hypot(b.x - a.x, b.z - a.z)) /
          2,
      );
    return { ...route.samples[i], position: p, tangent, sM: length, curvature };
  });
  return {
    ...route,
    samples,
    totalLengthM: length,
    checksum: `${route.checksum}/instructions-${checksum(JSON.stringify(instructions))}`,
  };
}
export function journeyPhase(route: CompiledRoute, elapsed: number) {
  if (elapsed < DEPARTURE_MS) return "離陸中";
  if (route.checksum.includes("/journey-v2/")) {
    const remain = route.durationMs - elapsed;
    if (remain <= 35000) return "格納庫へ移動中";
    if (remain <= 60000) return "着陸・減速中";
    if (remain <= ARRIVAL_MS) return "着陸へ進入中";
  }
  return "巡航中";
}
