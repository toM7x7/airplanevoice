import { DEFAULT_TABLE, type TableFrame } from "./spatial-alignment";

export interface VenuePoint {
  id: string;
  name: string;
  x: number;
  z: number;
}
export interface VenueMap extends TableFrame {
  version: 1;
  points: VenuePoint[];
  selectedId: string | null;
}
export const DEFAULT_VENUE: VenueMap = {
  version: 1,
  ...DEFAULT_TABLE,
  points: [
    { id: "booth-1", name: "仮ブース1", x: -1.5, z: -2 },
    { id: "booth-2", name: "仮ブース2", x: 1.5, z: -2 },
    { id: "booth-3", name: "仮ブース3", x: 0, z: -4 },
  ],
  selectedId: null,
};
/** Small, bounded coordinate-only map; supplied text never becomes HTML or commands. */
export function checkedVenue(value: unknown): VenueMap {
  if (!value || typeof value !== "object")
    throw new Error("会場の設定を確認してください。");
  const v = value as Record<string, unknown>;
  const valid = (n: unknown, min: number, max: number): n is number =>
    typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  if (
    v.version !== 1 ||
    !valid(v.baselineM, 0.3, 2) ||
    !valid(v.tableHeightM, 0.4, 1.4) ||
    (v.tableDepthM !== undefined && !valid(v.tableDepthM, 0.3, 2)) ||
    !Array.isArray(v.points) ||
    v.points.length < 1 ||
    v.points.length > 4
  )
    throw new Error(
      "会場は1〜4地点、机の高さ40〜140 cm、基準間隔30〜200 cmで設定してください。",
    );
  const points: VenuePoint[] = v.points.map((p: unknown) => {
    if (!p || typeof p !== "object")
      throw new Error("地点を確認してください。");
    const q = p as Record<string, unknown>;
    if (
      typeof q.id !== "string" ||
      !/^[a-zA-Z0-9-]{1,32}$/.test(q.id) ||
      typeof q.name !== "string" ||
      !q.name.trim() ||
      q.name.length > 24 ||
      !valid(q.x, -25, 25) ||
      !valid(q.z, -25, 25)
    )
      throw new Error(
        "地点名は24文字以内、座標は原点から±25 mで設定してください。",
      );
    return { id: q.id, name: q.name.trim(), x: q.x, z: q.z };
  });
  if (
    new Set(points.map((p) => p.id)).size !== points.length ||
    (v.selectedId !== null && !points.some((p) => p.id === v.selectedId))
  )
    throw new Error("地点IDと選択先を確認してください。");
  return {
    version: 1,
    baselineM: v.baselineM,
    tableHeightM: v.tableHeightM,
    ...(v.tableDepthM === undefined
      ? {}
      : { tableDepthM: v.tableDepthM as number }),
    points,
    selectedId: v.selectedId as string | null,
  };
}
