import {
  clamp,
  distance,
  finitePoint,
  lerp,
  mod,
  normalize,
  sub,
  checksum,
} from "./math";
import { HEAVY, presetRoute } from "./presets";
import type {
  AircraftProfile,
  CompiledRoute,
  RouteSample,
  RouteSpec,
  Vec3,
} from "./types";

function simplify(points: Vec3[], tolerance: number): Vec3[] {
  if (points.length < 3) return points;
  const a = points[0],
    b = points[points.length - 1];
  const ab = sub(b, a),
    mag2 = ab.x ** 2 + ab.y ** 2 + ab.z ** 2;
  let max = tolerance,
    index = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const ap = sub(points[i], a);
    const t = mag2
      ? clamp((ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / mag2, 0, 1)
      : 0;
    const d = distance(points[i], lerp(a, b, t));
    if (d > max) {
      max = d;
      index = i;
    }
  }
  return index < 0
    ? [a, b]
    : [
        ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
        ...simplify(points.slice(index), tolerance),
      ];
}

// Periodic cubic B-spline: C2 continuity, including the closing seam.
function spline(points: Vec3[], count = 768): Vec3[] {
  return Array.from({ length: count }, (_, i) => {
    const u = (i / count) * points.length,
      k = Math.floor(u),
      t = u - k;
    const w = [
      (1 - t) ** 3 / 6,
      (3 * t ** 3 - 6 * t ** 2 + 4) / 6,
      (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6,
      t ** 3 / 6,
    ];
    const p = { x: 0, y: 0, z: 0 };
    for (let j = 0; j < 4; j++) {
      const q = points[mod(k + j - 1, points.length)];
      p.x += q.x * w[j];
      p.y += q.y * w[j];
      p.z += q.z * w[j];
    }
    return p;
  });
}

function curvature(a: Vec3, b: Vec3, c: Vec3): number {
  const ux = b.x - a.x,
    uz = b.z - a.z,
    vx = c.x - b.x,
    vz = c.z - b.z;
  const denominator =
    Math.hypot(ux, uz) * Math.hypot(vx, vz) * Math.hypot(c.x - a.x, c.z - a.z);
  return denominator > 1e-6 ? (2 * (uz * vx - ux * vz)) / denominator : 0;
}

function resample(
  points: Vec3[],
  count = 512,
): { points: Vec3[]; total: number } {
  const lengths = [0];
  for (let i = 1; i <= points.length; i++)
    lengths.push(
      lengths[i - 1] + distance(points[i - 1], points[i % points.length]),
    );
  const total = lengths[lengths.length - 1];
  let index = 0;
  const result = Array.from({ length: count }, (_, i) => {
    const s = (total * i) / count;
    while (index < points.length - 1 && lengths[index + 1] < s) index++;
    const t = (s - lengths[index]) / (lengths[index + 1] - lengths[index] || 1);
    return lerp(points[index], points[(index + 1) % points.length], t);
  });
  return { points: result, total };
}

export function compileRoute(
  spec: RouteSpec,
  profile: AircraftProfile = HEAVY,
): CompiledRoute {
  if (
    ![
      profile.speedMps,
      profile.maxBankRad,
      profile.maxClimbGradient,
      profile.minAltitudeM,
      profile.maxAltitudeM,
    ].every(Number.isFinite) ||
    profile.speedMps < 20 ||
    profile.speedMps > 120 ||
    profile.maxBankRad < 0.1 ||
    profile.maxBankRad >= Math.PI / 2 ||
    profile.maxClimbGradient <= 0 ||
    profile.minAltitudeM < 1 ||
    profile.maxAltitudeM < profile.minAltitudeM
  )
    throw new Error("Invalid aircraft profile");
  if (spec.rawPoints.length > 1000)
    throw new Error("航路は1,000点以内にしてください。");
  if (!spec.rawPoints.every(finitePoint))
    throw new Error("航路に無効な座標があります。");
  const notices: string[] = [];
  let raw = spec.rawPoints.filter(
    (p, i, all) => i === 0 || distance(p, all[i - 1]) >= 4,
  );
  if (raw.length > 3 && distance(raw[0], raw[raw.length - 1]) < 4)
    raw = raw.slice(0, -1);
  if (raw.length < 4) {
    raw = presetRoute("orbit").rawPoints;
    notices.push("線が短いため、大きな旋回に整えました。");
  }
  if (raw.length > 32) raw = simplify(raw, 6);
  let points = spline(
    raw.map((p) => ({
      x: clamp(p.x, -6000, 6000),
      z: clamp(p.z, -6000, 6000),
      y: clamp(p.y, profile.minAltitudeM, profile.maxAltitudeM),
    })),
  );
  // Bound horizontal curvature by expanding about the centroid. Pathological
  // cusps fall back to a known route instead of yielding a huge, unusable orbit.
  const limit = (9.81 * Math.tan(profile.maxBankRad)) / profile.speedMps ** 2;
  const maxCurve = Math.max(
    ...points.map((p, i) =>
      Math.abs(
        curvature(
          points[mod(i - 1, points.length)],
          p,
          points[(i + 1) % points.length],
        ),
      ),
    ),
  );
  const total = resample(points).total;
  const expansion = Math.max(
    1,
    (maxCurve / limit) * 1.02,
    2000 / Math.max(total, 1),
  );
  if (expansion > 3.5 || total < 50) {
    // A fallback generated to fit the profile prevents recursive failure when
    // a profile needs a much larger radius than the default observation route.
    const radius = Math.max(1000, 1.3 / limit);
    const fallback: RouteSpec = {
      id: spec.id,
      revision: spec.revision,
      closed: true,
      rawPoints: Array.from({ length: 16 }, (_, i) => {
        const t = (i / 16) * Math.PI * 2;
        return {
          x: radius * Math.sin(t),
          y: clamp(240, profile.minAltitudeM, profile.maxAltitudeM),
          z: -radius - 400 + radius * Math.cos(t),
        };
      }),
    };
    // Clamp the supported profile envelope to the compiler's world bounds.
    if (radius > 2600)
      throw new Error("この速度と旋回設定では、観察空域に航路が収まりません。");
    const safe = compileRoute(fallback, profile);
    return {
      ...safe,
      routeId: spec.id,
      notices: ["急な折り返しを、大きな旋回に置き換えました。"],
    };
  }
  if (expansion > 1.03) {
    const center = points.reduce(
      (a, p) => ({
        x: a.x + p.x / points.length,
        y: 0,
        z: a.z + p.z / points.length,
      }),
      { x: 0, y: 0, z: 0 },
    );
    points = points.map((p) => ({
      x: center.x + (p.x - center.x) * expansion,
      y: p.y,
      z: center.z + (p.z - center.z) * expansion,
    }));
    notices.push("機体が無理なく曲がれるよう、旋回を広げました。");
  }
  const maxSlope = Math.max(
    ...points.map((p, i) => {
      const q = points[(i + 1) % points.length];
      return (
        Math.abs(q.y - p.y) / Math.max(0.01, Math.hypot(q.x - p.x, q.z - p.z))
      );
    }),
  );
  if (maxSlope > profile.maxClimbGradient) {
    const mean = points.reduce((a, p) => a + p.y / points.length, 0);
    points = points.map((p) => ({
      ...p,
      y: mean + ((p.y - mean) * profile.maxClimbGradient) / maxSlope,
    }));
    notices.push("上り下りを、なだらかに整えました。");
  }
  const sampled = resample(points);
  const samples: RouteSample[] = sampled.points.map((p, i, all) => ({
    sM: (i / all.length) * sampled.total,
    position: p,
    tangent: normalize(
      sub(all[(i + 1) % all.length], all[mod(i - 1, all.length)]),
    ),
    curvature: curvature(
      all[mod(i - 1, all.length)],
      p,
      all[(i + 1) % all.length],
    ),
  }));
  return {
    routeId: spec.id,
    revision: spec.revision,
    samples,
    totalLengthM: sampled.total,
    durationMs: (sampled.total / profile.speedMps) * 1000,
    checksum: checksum({
      positions: sampled.points.map((p) =>
        [p.x, p.y, p.z].map((v) => Math.round(v * 1000)),
      ),
      profile,
    }),
    notices,
    speedMps: profile.speedMps,
    maxBankRad: profile.maxBankRad,
  };
}
