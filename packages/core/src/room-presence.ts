import {
  ALIGNMENT_CHECK_TOLERANCE_M,
  DEFAULT_TABLE,
  type TableFrame,
} from "./spatial-alignment";

export type CalibrationStage =
  | "none"
  | "a"
  | "b"
  | "c"
  | "checking"
  | "aligned"
  | "lost"
  | "placing"
  | "placed";
export interface SpatialPresence {
  mode: "browser" | "vr" | "ar";
  calibration: CalibrationStage;
  frame: string;
  checkErrorM: number | null;
}
export interface RoomParticipant {
  id: string;
  slot: number;
  role: "editor" | "viewer";
  presence: SpatialPresence | null;
  updatedAt: number;
}
export const PRESENCE_FRESH_MS = 45000;
export const tableFrameId = (f: TableFrame = DEFAULT_TABLE) =>
  `${f.baselineM}/${f.tableHeightM}${f.tableDepthM === undefined ? "" : `/${f.tableDepthM}`}`;

/** Accept only small, finite diagnostics; no head pose, microphone or device identifier. */
export function checkedPresence(value: unknown): SpatialPresence {
  if (!value || typeof value !== "object")
    throw new Error("端末の状態を確認してください。");
  const p = value as Record<string, unknown>;
  const dimensions =
    typeof p.frame === "string" ? p.frame.split("/").map(Number) : [];
  if (
    !["browser", "vr", "ar"].includes(p.mode as string) ||
    ![
      "none",
      "a",
      "b",
      "c",
      "checking",
      "aligned",
      "lost",
      "placing",
      "placed",
    ].includes(p.calibration as string) ||
    typeof p.frame !== "string" ||
    p.frame.length > 64 ||
    (dimensions.length !== 2 && dimensions.length !== 3) ||
    !dimensions.every(Number.isFinite) ||
    dimensions[0] < 0.3 ||
    dimensions[0] > 2 ||
    dimensions[1] < 0.4 ||
    dimensions[1] > 1.4 ||
    (dimensions.length === 3 && (dimensions[2] < 0.3 || dimensions[2] > 2)) ||
    !(
      p.checkErrorM === null ||
      (typeof p.checkErrorM === "number" &&
        Number.isFinite(p.checkErrorM) &&
        p.checkErrorM >= 0 &&
        p.checkErrorM <= 100)
    )
  )
    throw new Error("端末の状態を確認してください。");
  return {
    mode: p.mode as SpatialPresence["mode"],
    calibration:
      p.mode === "browser" ? "none" : (p.calibration as CalibrationStage),
    frame: p.frame,
    checkErrorM: p.mode === "browser" ? null : (p.checkErrorM as number | null),
  };
}

export function participantStatus(
  p: RoomParticipant,
  frame: TableFrame,
  now: number,
) {
  if (now - p.updatedAt > PRESENCE_FRESH_MS) return "更新待ち";
  const s = p.presence;
  if (!s) return "位置合わせ情報なし";
  if (s.mode === "browser") return "ブラウザで参加";
  if (s.frame !== tableFrameId(frame))
    return "机の設定が変わりました・合わせ直し";
  if (s.calibration === "aligned")
    return s.checkErrorM !== null &&
      s.checkErrorM <= ALIGNMENT_CHECK_TOLERANCE_M
      ? `確認済み・Cのずれ ${(s.checkErrorM * 100).toFixed(1)} cm`
      : "Cの測定待ち";
  return (
    {
      none: "位置合わせ前",
      placing: "机の枠を手動で調整中",
      placed: "手動配置・目視確認済み（未測定）",
      a: "Aを取得中",
      b: "Bを取得中",
      c: "Cを測定中",
      checking: "重なりの確認待ち",
      lost: "位置を見失いました・合わせ直し",
    } as const
  )[s.calibration];
}

export function alignedParticipants(
  ps: RoomParticipant[],
  frame: TableFrame,
  now: number,
) {
  return ps.filter(
    (p) =>
      now - p.updatedAt <= PRESENCE_FRESH_MS &&
      p.presence?.mode !== "browser" &&
      p.presence?.frame === tableFrameId(frame) &&
      p.presence?.calibration === "aligned" &&
      p.presence.checkErrorM !== null &&
      p.presence.checkErrorM <= ALIGNMENT_CHECK_TOLERANCE_M,
  );
}
