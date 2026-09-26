import { expect, it } from "vitest";
import {
  alignedParticipants,
  checkedPresence,
  participantStatus,
  tableFrameId,
  type RoomParticipant,
} from "../packages/core/src/room-presence";
import { DEFAULT_TABLE } from "../packages/core/src/spatial-alignment";

const peer = (patch: Partial<RoomParticipant> = {}): RoomParticipant => ({
  id: "peer",
  slot: 1,
  role: "viewer",
  updatedAt: 1000,
  presence: {
    mode: "ar",
    calibration: "aligned",
    frame: tableFrameId(),
    checkErrorM: 0.02,
  },
  ...patch,
});
it("reports calibration independently of editing permissions and excludes stale or mismatched frames", () => {
  expect(alignedParticipants([peer()], DEFAULT_TABLE, 2000)).toHaveLength(1);
  expect(participantStatus(peer(), DEFAULT_TABLE, 2000)).toContain("2.0 cm");
  expect(alignedParticipants([peer()], DEFAULT_TABLE, 50000)).toHaveLength(0);
  expect(participantStatus(peer(), DEFAULT_TABLE, 50000)).toBe("更新待ち");
  expect(
    alignedParticipants([peer()], { ...DEFAULT_TABLE, baselineM: 0.8 }, 2000),
  ).toHaveLength(0);
  expect(
    participantStatus(peer(), { ...DEFAULT_TABLE, baselineM: 0.8 }, 2000),
  ).toContain("合わせ直し");
  for (const calibration of ["none", "c", "checking", "lost"] as const) {
    expect(
      alignedParticipants(
        [peer({ presence: { ...peer().presence!, calibration } })],
        DEFAULT_TABLE,
        2000,
      ),
    ).toHaveLength(0);
  }
  expect(
    alignedParticipants(
      [peer({ presence: { ...peer().presence!, checkErrorM: null } })],
      DEFAULT_TABLE,
      2000,
    ),
  ).toHaveLength(0);
  expect(
    alignedParticipants(
      [peer({ presence: { ...peer().presence!, checkErrorM: 0.051 } })],
      DEFAULT_TABLE,
      2000,
    ),
  ).toHaveLength(0);
});
it("only accepts finite bounded diagnostics and clears XR readiness on return to browser", () => {
  const p = peer().presence!;
  expect(
    checkedPresence({
      ...p,
      frame: tableFrameId({ baselineM: 1 / 3, tableHeightM: 0.75 }),
    }).frame,
  ).toContain("0.333333");
  expect(
    checkedPresence({ ...p, secret: "omit", headPose: [1, 2, 3] }),
  ).toEqual(p);
  expect(checkedPresence({ ...p, mode: "browser" })).toEqual({
    ...p,
    mode: "browser",
    calibration: "none",
    checkErrorM: null,
  });
  for (const patch of [
    { checkErrorM: Infinity },
    { checkErrorM: -1 },
    { checkErrorM: 101 },
    { frame: "unknown" },
    { mode: "other" },
    { calibration: "ready" },
  ]) {
    expect(() => checkedPresence({ ...p, ...patch })).toThrow();
  }
  expect(participantStatus(peer({ presence: null }), DEFAULT_TABLE, 2000)).toBe(
    "位置合わせ情報なし",
  );
});
