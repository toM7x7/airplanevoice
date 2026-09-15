import { clamp, checksum } from "./math";
import type { RouteSpec } from "./types";
import { generatedPoints } from "./workshop";

export const EVOLUTION_REST_MS = 6000;
export interface EvolutionSettings {
  enabled: boolean;
  amount: number;
}

// Every variant is derived from the original route, so long runs cannot drift
// indefinitely. Nearby laps sample nearby phases of the same bounded waves.
export function evolveRoute(
  base: RouteSpec,
  lap: number,
  amount: number,
): RouteSpec {
  if (
    !Number.isSafeInteger(lap) ||
    lap < 0 ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > 1
  )
    throw new Error("周回と変化の量を確認してください。");
  const spec = structuredClone(base);
  if (!lap || !amount) return spec;
  const key = checksum({ points: base.rawPoints, generator: base.generator });
  let hash = 0;
  for (const char of key)
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  const phase = (hash / 4294967296) * Math.PI * 2;
  const wave = (offset: number) =>
    ((Math.sin(phase + offset + lap * (0.48 + offset * 0.03)) -
      Math.sin(phase + offset)) /
      2) *
    amount;
  spec.revision = base.revision + lap;
  if (spec.generator) {
    // Preserve the two anchor positions and their specified passage altitude.
    spec.generator.widthM = clamp(
      base.generator!.widthM * (1 + 0.2 * wave(0)),
      400,
      1500,
    );
    spec.generator.variation = clamp(
      base.generator!.variation + 0.45 * wave(2),
      0,
      1,
    );
    spec.rawPoints = generatedPoints(spec.generator, spec.generator.widthM, 16);
  } else {
    const center = base.rawPoints.reduce(
      (c, p) => ({
        x: c.x + p.x / base.rawPoints.length,
        z: c.z + p.z / base.rawPoints.length,
      }),
      { x: 0, z: 0 },
    );
    const angle = 0.22 * wave(1),
      scale = 1 + 0.12 * wave(0);
    const c = Math.cos(angle),
      s = Math.sin(angle);
    spec.rawPoints = base.rawPoints.map((p, i) => {
      const x = p.x - center.x,
        z = p.z - center.z;
      return {
        x: center.x + (x * c - z * s) * scale,
        z: center.z + (x * s + z * c) * scale,
        y: clamp(
          p.y +
            35 *
              wave(2) *
              Math.sin((i / base.rawPoints.length) * Math.PI * 2 + phase),
          120,
          650,
        ),
      };
    });
  }
  return spec;
}
