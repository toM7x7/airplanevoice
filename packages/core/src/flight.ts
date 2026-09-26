import { clamp, lerp, mod, normalize } from "./math";
import type { CompiledRoute, FlightPose } from "./types";

export function flightPose(
  route: CompiledRoute,
  elapsedMs: number,
): FlightPose {
  const phase01 = route.loop === false
    ? clamp(elapsedMs / route.durationMs, 0, 1)
    : mod(Math.max(0, elapsedMs), route.durationMs) / route.durationMs;
  const index = phase01 * (route.samples.length - (route.loop === false ? 1 : 0)),
    base = Math.floor(index),
    t = index - base;
  const a = route.samples[base],
    b = route.samples[route.loop === false ? Math.min(base + 1, route.samples.length - 1) : (base + 1) % route.samples.length];
  let curvature = a.curvature + (b.curvature - a.curvature) * t;
  const response = route.bankResponseSec ?? 0;
  if (response > 0) {
    // Finite causal smoothing: replayable attitude inertia, not aerodynamic force simulation.
    let sum = 0,
      weight = 0;
    for (let i = 0; i < 8; i++) {
      const rawPast = index -
          (((i / 7) * response * 1000) / route.durationMs) *
            route.samples.length;
      const past = route.loop === false ? Math.max(0, rawPast) : mod(rawPast, route.samples.length);
      const j = Math.floor(past),
        fraction = past - j,
        w = Math.exp((-3 * i) / 7);
      sum +=
        (route.samples[j].curvature * (1 - fraction) +
          route.samples[route.loop === false ? Math.min(j + 1, route.samples.length - 1) : (j + 1) % route.samples.length].curvature * fraction) *
        w;
      weight += w;
    }
    curvature = sum / weight;
  }
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
