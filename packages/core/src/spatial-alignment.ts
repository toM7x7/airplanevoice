import type { Vec3 } from "./types";

export interface TableFrame {
  baselineM: number;
  tableHeightM: number;
}
export interface Alignment {
  yaw: number;
  offset: Vec3;
  measuredM: number;
}
export const DEFAULT_TABLE: TableFrame = { baselineM: 0.6, tableHeightM: 0.75 };

export function rotateY(p: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  return { x: c * p.x + s * p.z, y: p.y, z: -s * p.x + c * p.z };
}
export function alignedPoint(p: Vec3, a: Alignment): Vec3 {
  const r = rotateY(p, a.yaw);
  return { x: r.x + a.offset.x, y: r.y + a.offset.y, z: r.z + a.offset.z };
}
/** A is the tabletop origin, A→B is +X. Preserve physical metres: never fit scale. */
export function solveAlignment(a: Vec3, b: Vec3, frame: TableFrame): Alignment {
  if (
    ![a.x, a.y, a.z, b.x, b.y, b.z, frame.baselineM, frame.tableHeightM].every(
      Number.isFinite,
    )
  )
    throw new Error("基準点を取得できませんでした。もう一度合わせてください。");
  if (
    frame.baselineM < 0.3 ||
    frame.baselineM > 2 ||
    frame.tableHeightM < 0.4 ||
    frame.tableHeightM > 1.4
  )
    throw new Error("机の高さ・AとBの間隔を確認してください。");
  const dx = b.x - a.x,
    dz = b.z - a.z,
    measuredM = Math.hypot(dx, dz);
  if (Math.abs(b.y - a.y) > 0.08)
    throw new Error("AとBを同じ机の高さに合わせてください。");
  if (
    Math.abs(measuredM - frame.baselineM) >
    Math.max(0.04, frame.baselineM * 0.12)
  )
    throw new Error(
      `取得した間隔は${Math.round(measuredM * 100)} cmです。設定と目印を確認してください。`,
    );
  const yaw = Math.atan2(dz, dx),
    r = rotateY(a, yaw);
  return {
    yaw,
    measuredM,
    offset: { x: -r.x, y: frame.tableHeightM - r.y, z: -r.z },
  };
}
