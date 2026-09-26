import { expect, it } from "vitest";
import {
  tableInFront,
  moveTable,
  placementAlignment,
  alignedPoint,
  rotateY,
  checkAlignment,
} from "../packages/core/src/spatial-alignment";
import { checkedVenue, DEFAULT_VENUE } from "../packages/core/src/venue";
import {
  checkedPresence,
  tableFrameId,
  participantStatus,
  alignedParticipants,
} from "../packages/core/src/room-presence";

const frame = { baselineM: 1.2, tableDepthM: 0.6, tableHeightM: 0.75 };
it("places a rectangular frame in front of a displaced/turned operator and preserves physical metres", () => {
  for (const yaw of [0, 0.7, Math.PI, -Math.PI / 2]) {
    const head = { x: 12, y: 1.2, z: -9 },
      p = tableInFront(head, yaw, frame);
    const relative = rotateY(
      { x: p.a.x - head.x, y: 0, z: p.a.z - head.z },
      -yaw,
    );
    expect(relative.x).toBeCloseTo(-0.6);
    expect(relative.z).toBeCloseTo(-0.65);
    const a = placementAlignment(p, frame),
      mapped = alignedPoint(p.a, a);
    expect(mapped.x).toBeCloseTo(0);
    expect(mapped.y).toBeCloseTo(0.75);
    expect(mapped.z).toBeCloseTo(0);
    const c = rotateY({ x: 0, y: 0, z: -0.6 }, yaw);
    expect(
      checkAlignment({ x: p.a.x + c.x, y: p.a.y, z: p.a.z + c.z }, a, frame)
        .distanceM,
    ).toBeCloseTo(0);
    const moved = alignedPoint({ x: p.a.x + 1, y: p.a.y, z: p.a.z }, a);
    expect(Math.hypot(moved.x, moved.z)).toBeCloseTo(1);
  }
});
it("rotates around the centre and translates in the displayed table axes", () => {
  const p = tableInFront({ x: 2, y: 1.2, z: -3 }, 0.9, frame);
  const centre = (v: typeof p) => {
    const d = rotateY({ x: 0.6, y: 0, z: -0.3 }, v.yaw);
    return [v.a.x + d.x, v.a.z + d.z];
  };
  const turn = moveTable(p, frame, 0, 0, 0, Math.PI / 2);
  centre(turn).forEach((v, i) => expect(v).toBeCloseTo(centre(p)[i]));
  const move = moveTable(p, frame, 0.05, 0.02, 0.05);
  const delta = rotateY(
    { x: move.a.x - p.a.x, y: move.a.y - p.a.y, z: move.a.z - p.a.z },
    -p.yaw,
  );
  expect(delta.x).toBeCloseTo(0.05);
  expect(delta.y).toBeCloseTo(0.02);
  expect(delta.z).toBeCloseTo(0.05);
});
it("preserves old room dimensions, validates new depth and never reports manual placement as measured", () => {
  expect(checkedVenue(DEFAULT_VENUE)).toEqual(DEFAULT_VENUE);
  const venue = checkedVenue({ ...DEFAULT_VENUE, ...frame });
  expect(venue.tableDepthM).toBe(0.6);
  for (const bad of [NaN, 0, 3, "0.6"])
    expect(() => checkedVenue({ ...venue, tableDepthM: bad })).toThrow();
  const presence = checkedPresence({
    mode: "ar",
    calibration: "placed",
    frame: tableFrameId(venue),
    checkErrorM: null,
  });
  const p = {
    id: "a",
    slot: 1,
    role: "viewer" as const,
    presence,
    updatedAt: 1,
  };
  expect(participantStatus(p, venue, 2)).toContain("未測定");
  expect(alignedParticipants([p], venue, 2)).toHaveLength(0);
  expect(participantStatus(p, { ...venue, tableDepthM: 0.8 }, 2)).toContain(
    "合わせ直し",
  );
});
