import type { Vec3 } from "./types";
export const clamp = (v: number, a: number, b: number) =>
  Math.max(a, Math.min(b, v));
export const mod = (a: number, n: number) => ((a % n) + n) % n;
export const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});
export const sub = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
export const mul = (a: Vec3, s: number): Vec3 => ({
  x: a.x * s,
  y: a.y * s,
  z: a.z * s,
});
export const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
export const distance = (a: Vec3, b: Vec3) => length(sub(a, b));
export const normalize = (a: Vec3): Vec3 => mul(a, 1 / (length(a) || 1));
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  add(a, mul(sub(b, a), t));
export const finitePoint = (p: unknown): p is Vec3 =>
  !!p &&
  typeof p === "object" &&
  ["x", "y", "z"].every((k) =>
    Number.isFinite((p as Record<string, unknown>)[k]),
  );

export function checksum(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
