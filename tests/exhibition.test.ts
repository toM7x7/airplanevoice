import { describe, expect, it } from "vitest";
import {
  advanceExhibition,
  changeRoom,
  EXHIBITION_TTL_MS,
  newRoom,
  nextRoomAlarm,
  ROOM_TTL_MS,
} from "../packages/core/src/shared-room";
import { visitorKey } from "../packages/core/src/room-access";

const now = 1_800_000_000_000;
const start = () =>
  advanceExhibition(
    changeRoom(
      newRoom(now, true),
      {
        id: "repeat-start",
        revision: 0,
        type: "repeat",
        enabled: true,
      },
      now,
    ),
    now,
  );

describe("exhibition flight authority", () => {
  it("keeps ordinary rooms at one hour and gives exhibitions eight hours", () => {
    expect(newRoom(now).expiresAt).toBe(now + ROOM_TTL_MS);
    expect(newRoom(now, true).expiresAt).toBe(now + EXHIBITION_TTL_MS);
    expect(() =>
      changeRoom(
        newRoom(now),
        { id: "repeat-start", revision: 0, type: "repeat", enabled: true },
        now,
      ),
    ).toThrow("展示用");
  });
  it("starts only one flight and repeated alarms cannot duplicate an active flight", () => {
    const state = start();
    expect(state.flights).toHaveLength(1);
    expect(state.flights[0].startsAt).toBe(now + 2500);
    expect(advanceExhibition(state, now)).toBe(state);
    expect(advanceExhibition(state, state.flights[0].clearAt - 1)).toBe(state);
    expect(nextRoomAlarm(state, now)).toBe(state.flights[0].clearAt);
  });
  it("a late alarm starts one new flight with the latest draft and keeps history bounded", () => {
    const state = start();
    const recipe = structuredClone(state.draft);
    recipe.route.altitudeM += 20;
    const edited = changeRoom(
      state,
      { id: "edit-00001", revision: state.revision, type: "edit", recipe },
      now + 4000,
    );
    expect(edited.flights[0]).toEqual(state.flights[0]);
    const late = state.flights[0].clearAt + 300000;
    const next = advanceExhibition(edited, late);
    expect(next.flights).toHaveLength(1);
    expect(next.flights[0].startsAt).toBe(late + 2500);
    expect(next.flights[0].recipe).toEqual(recipe);
    expect(advanceExhibition(next, late)).toBe(next);
  });
  it("stopping finishes the scheduled flight and the expiry alarm cannot restart it", () => {
    const state = start();
    const stopped = changeRoom(
      state,
      {
        id: "repeat-stop",
        revision: state.revision,
        type: "repeat",
        enabled: false,
      },
      now + 3000,
    );
    expect(stopped.flights).toEqual(state.flights);
    expect(advanceExhibition(stopped, state.flights[0].clearAt)).toBe(stopped);
    expect(nextRoomAlarm(stopped, now)).toBe(stopped.expiresAt);
    expect(advanceExhibition(state, state.expiresAt)).toBe(state);
    expect(nextRoomAlarm(state, state.expiresAt - 1)).toBe(state.expiresAt);
  });
  it("uses a stable distinct visitor capability without exposing the editor key", async () => {
    const editor = "a".repeat(64);
    const visitor = await visitorKey(editor);
    expect(visitor).toMatch(/^[a-f0-9]{64}$/);
    expect(visitor).not.toBe(editor);
    expect(await visitorKey(editor)).toBe(visitor);
    expect(await visitorKey("b".repeat(64))).not.toBe(visitor);
  });
});
