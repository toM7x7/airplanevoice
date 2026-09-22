import type { Vec3 } from "./types";

export interface TableFrame {
  baselineM: number;
  tableHeightM: number;
  /** Older rooms use a square reference frame. */
  tableDepthM?: number;
}
export const tableDepth = (f: TableFrame) => f.tableDepthM ?? f.baselineM;
export interface TablePlacement {
  a: Vec3;
  yaw: number;
}

/** Physical reference-space placement, independent of the shared flight coordinates. */
export function tableInFront(
  head: Vec3,
  yaw: number,
  frame: TableFrame,
): TablePlacement {
  const d = rotateY({ x: -frame.baselineM / 2, y: 0, z: -0.65 }, yaw);
  return {
    a: { x: head.x + d.x, y: frame.tableHeightM, z: head.z + d.z },
    yaw,
  };
}
export function placementAlignment(
  p: TablePlacement,
  frame: TableFrame,
): Alignment {
  const r = rotateY(p.a, -p.yaw);
  return {
    yaw: -p.yaw,
    offset: { x: -r.x, y: frame.tableHeightM - r.y, z: -r.z },
    measuredM: frame.baselineM,
  };
}
/** Translation follows the table axes; rotation keeps its centre fixed. */
export function moveTable(
  p: TablePlacement,
  frame: TableFrame,
  x: number,
  y: number,
  z: number,
  yaw = 0,
): TablePlacement {
  const centre = { x: frame.baselineM / 2, y: 0, z: -tableDepth(frame) / 2 };
  const old = rotateY(centre, p.yaw),
    next = rotateY(centre, p.yaw + yaw);
  const d = rotateY({ x, y, z }, p.yaw);
  return {
    yaw: p.yaw + yaw,
    a: {
      x: p.a.x + d.x + old.x - next.x,
      y: p.a.y + y,
      z: p.a.z + d.z + old.z - next.z,
    },
  };
}
export interface Alignment {
  yaw: number;
  offset: Vec3;
  measuredM: number;
}
export const DEFAULT_TABLE: TableFrame = { baselineM: 0.6, tableHeightM: 0.75 };
// Provisional acceptance threshold for the tabletop trial, not an accuracy guarantee.
export const ALIGNMENT_CHECK_TOLERANCE_M = 0.05;
export interface AlignmentCheck {
  delta: Vec3;
  distanceM: number;
  acceptable: boolean;
}

/** C is independent of the A/B fit. It checks direction, height and translation. */
export function checkAlignment(
  measuredC: Vec3,
  alignment: Alignment,
  frame: TableFrame,
): AlignmentCheck {
  const p = alignedPoint(measuredC, alignment);
  const delta = {
    x: p.x,
    y: p.y - frame.tableHeightM,
    z: p.z + tableDepth(frame),
  };
  if (!Object.values(delta).every(Number.isFinite))
    throw new Error(
      "Cの位置を取得できませんでした。もう一度合わせてください。",
    );
  const distanceM = Math.hypot(delta.x, delta.y, delta.z);
  return {
    delta,
    distanceM,
    acceptable: distanceM <= ALIGNMENT_CHECK_TOLERANCE_M,
  };
}

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
