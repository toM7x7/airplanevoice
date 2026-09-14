import { clamp, lerp, mod, normalize } from "./math";
import type { CompiledRoute, FlightPose } from "./types";

export function flightPose(
  route: CompiledRoute,
  elapsedMs: number,
): FlightPose {
  const phase01 =
    mod(Math.max(0, elapsedMs), route.durationMs) / route.durationMs;
  const index = phase01 * route.samples.length,
    base = Math.floor(index),
    t = index - base;
  const a = route.samples[base],
    b = route.samples[(base + 1) % route.samples.length];
  const curvature = a.curvature + (b.curvature - a.curvature) * t;
  return {
    position: lerp(a.position, b.position, t),
    tangent: normalize(lerp(a.tangent, b.tangent, t)),
    phase01,
    bankRad: clamp(
      Math.atan((route.speedMps ** 2 * curvature) / 9.81),
      -route.maxBankRad,
      route.maxBankRad,
    ),
  };
}
