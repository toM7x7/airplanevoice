import type { AircraftProfile, RouteSpec, Vec3 } from "./types";

// Staged observation speed, not an aircraft performance specification.
export const HEAVY: AircraftProfile = {
  id: "heavy_four_engine",
  speedMps: 58,
  maxBankRad: (25 * Math.PI) / 180,
  maxClimbGradient: 0.12,
  minAltitudeM: 120,
  maxAltitudeM: 650,
};
export const PRESETS = [
  {
    id: "orbit",
    name: "大きな旋回",
    caption: "ゆっくりと、翼を見せる。",
    number: "01",
  },
  {
    id: "eight",
    name: "八の字",
    caption: "左へ、右へ。空を折り返す。",
    number: "02",
  },
  {
    id: "rise",
    name: "ゆるい起伏",
    caption: "少し高く、光のほうへ。",
    number: "03",
  },
] as const;
export type PresetId = (typeof PRESETS)[number]["id"];

export function presetRoute(
  id: PresetId,
  revision = 0,
  altitude = 240,
): RouteSpec {
  const rawPoints: Vec3[] = Array.from(
    { length: id === "eight" ? 16 : 12 },
    (_, i) => {
      const count = id === "eight" ? 16 : 12;
      // Start on the left, approach the near side within the first quarter lap.
      const t = -Math.PI / 2 + (i / count) * Math.PI * 2;
      if (id === "eight") {
        const denominator = 1 + Math.cos(t) ** 2;
        return {
          x: (1100 * Math.sin(t)) / denominator,
          y: altitude + 60 * Math.cos(t),
          z: -1750 + (1100 * Math.sin(t) * Math.cos(t)) / denominator,
        };
      }
      return {
        x: 930 * Math.sin(t),
        y: altitude + (id === "rise" ? 120 * (1 - Math.cos(t)) : 0),
        z: -1270 + 870 * Math.cos(t),
      };
    },
  );
  return { id, revision, rawPoints, closed: true };
}
export const OBSERVERS = [
  { id: "garden", name: "草原", position: { x: 0, y: 1.7, z: 0 } },
  { id: "hill", name: "丘の上", position: { x: 420, y: 70, z: 250 } },
  { id: "shore", name: "水辺", position: { x: -540, y: 1.7, z: 350 } },
] as const;
