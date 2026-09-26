import { checkedSound, type SoundDesign } from "./sound-design";
import type { RouteSpec, Vec3 } from "./types";

export interface AircraftDesign {
  bodyLengthM: number;
  wingSpanM: number;
  engineCount: 2 | 4;
  sound?: SoundDesign;
  color?: string;
  bodyColor?: string;
  bodyWidthM?: number;
  wingSweepDeg?: number;
  engineScale?: number;
  wingletHeightM?: number;
}
export interface FlightSettings {
  speedMps: number;
  bankResponseSec: number;
}
export interface RouteGenerator {
  kind: "two-point";
  a: { x: number; z: number };
  b: { x: number; z: number };
  altitudeM: number;
  widthM: number;
  variation: number;
  seed: number;
}
export interface WorkshopRecipe {
  version: 1;
  aircraft: AircraftDesign;
  route: RouteGenerator;
  flight: FlightSettings;
}
export const DEFAULT_AIRCRAFT: AircraftDesign = {
  bodyLengthM: 71,
  wingSpanM: 64,
  engineCount: 4,
};
export const DEFAULT_WORKSHOP: WorkshopRecipe = {
  version: 1,
  aircraft: DEFAULT_AIRCRAFT,
  route: {
    kind: "two-point",
    a: { x: -1100, z: -1400 },
    b: { x: 1100, z: -1400 },
    altitudeM: 240,
    widthM: 900,
    variation: 0.3,
    seed: 7,
  },
  flight: { speedMps: 58, bankResponseSec: 1.2 },
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function keys(
  v: unknown,
  expected: string[],
  label: string,
): asserts v is Record<string, unknown> {
  if (
    !record(v) ||
    Object.keys(v).length !== expected.length ||
    !expected.every((k) => Object.hasOwn(v, k))
  )
    throw new Error(`${label}の項目を確認してください。`);
}
function range(
  value: unknown,
  low: number,
  high: number,
  label: string,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < low ||
    value > high
  )
    throw new Error(`${label}は${low}〜${high}で指定してください。`);
}
export function validateAircraft(
  value: unknown,
): asserts value is AircraftDesign {
  const withSound =
    !!value && typeof value === "object" && Object.hasOwn(value, "sound");
  const withColor =
    !!value && typeof value === "object" && Object.hasOwn(value, "color");
  keys(
    value,
    [
      "bodyLengthM",
      "wingSpanM",
      "engineCount",
      ...(withSound ? ["sound"] : []),
      ...(withColor ? ["color"] : []),
      ...["bodyColor","bodyWidthM","wingSweepDeg","engineScale","wingletHeightM"].filter(k=>!!value && typeof value === "object" && Object.hasOwn(value,k)),
    ],
    "機体",
  );
  if (withSound) checkedSound(value.sound);
  if (
    withColor &&
    (typeof value.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value.color))
  )
    throw new Error("機体の色は6桁の色番号で指定してください。");
  range(value.bodyLengthM, 50, 85, "胴体の長さ");
  range(value.wingSpanM, 45, 85, "翼の幅");
  if(value.bodyColor !== undefined && (typeof value.bodyColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value.bodyColor))) throw new Error("胴体の色は6桁の色番号で指定してください。");
  if(value.bodyWidthM !== undefined) range(value.bodyWidthM,4.5,8,"胴体の太さ");
  if(value.wingSweepDeg !== undefined) range(value.wingSweepDeg,20,38,"翼の後退角");
  if(value.engineScale !== undefined) range(value.engineScale,.8,1.3,"エンジンの大きさ");
  if(value.wingletHeightM !== undefined) range(value.wingletHeightM,0,3,"翼端の高さ");
  if (value.engineCount !== 2 && value.engineCount !== 4)
    throw new Error("エンジンは2基または4基です。");
}
export function validateFlight(
  value: unknown,
): asserts value is FlightSettings {
  keys(value, ["speedMps", "bankResponseSec"], "飛び方");
  range(value.speedMps, 35, 75, "速度");
  range(value.bankResponseSec, 0, 3, "傾きの追従時間");
}
export function validateGenerator(
  value: unknown,
): asserts value is RouteGenerator {
  keys(
    value,
    ["kind", "a", "b", "altitudeM", "widthM", "variation", "seed"],
    "航路",
  );
  if (value.kind !== "two-point")
    throw new Error("航路の種類はtwo-pointです。");
  for (const name of ["a", "b"]) {
    keys(value[name], ["x", "z"], `${name}地点`);
    range(value[name].x, -3000, 3000, `${name}地点のX`);
    range(value[name].z, -4200, 600, `${name}地点のZ`);
  }
  range(value.altitudeM, 140, 500, "高度");
  range(value.widthM, 400, 1500, "回り込みの幅");
  range(value.variation, 0, 1, "変化の量");
  range(value.seed, 0, 2147483647, "シード");
  if (!Number.isInteger(value.seed))
    throw new Error("シードは整数で指定してください。");
}
export function parseWorkshop(text: string): WorkshopRecipe {
  if (text.length > 12000)
    throw new Error("レシピは12,000文字以内にしてください。");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(
      "JSONの書き方を確認してください。カンマや括弧が足りない可能性があります。",
    );
  }
  keys(value, ["version", "aircraft", "route", "flight"], "レシピ");
  if (value.version !== 1) throw new Error("対応するレシピのversionは1です。");
  validateAircraft(value.aircraft);
  validateGenerator(value.route);
  validateFlight(value.flight);
  return value as unknown as WorkshopRecipe;
}
export function generatedPoints(
  g: RouteGenerator,
  width = g.widthM,
  count = 768,
): Vec3[] {
  const dx = g.b.x - g.a.x,
    dz = g.b.z - g.a.z,
    len = Math.hypot(dx, dz);
  if (len < 1) throw new Error("AとBを別の場所に置いてください。");
  // A fixed seed determines smooth low-frequency variation, never per-frame noise.
  const phase =
    (((Math.imul(g.seed ^ 92821, 1664525) + 1013904223) >>> 0) / 4294967296) *
    Math.PI *
    2;
  return Array.from({ length: count }, (_, i) => {
    const t = (i / count) * Math.PI * 2;
    const along = (-len / 2) * Math.cos(t);
    const across =
      width * Math.sin(t) * (1 + g.variation * 0.08 * Math.sin(2 * t + phase));
    return {
      x: (g.a.x + g.b.x) / 2 + (dx / len) * along - (dz / len) * across,
      z: (g.a.z + g.b.z) / 2 + (dz / len) * along + (dx / len) * across,
      y:
        g.altitudeM +
        g.variation * 40 * Math.sin(t) ** 2 * Math.sin(2 * t + phase),
    };
  });
}
export function workshopSpec(
  recipe: WorkshopRecipe,
  revision: number,
): RouteSpec {
  const valid = parseWorkshop(JSON.stringify(recipe));
  return {
    id: "two-point",
    revision,
    closed: true,
    rawPoints: generatedPoints(valid.route, valid.route.widthM, 16),
    generator: valid.route,
    flight: valid.flight,
  };
}
