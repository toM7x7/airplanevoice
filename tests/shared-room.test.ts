import { describe, expect, it, vi } from "vitest";
import { Experience } from "../packages/core/src/experience";
import { DEFAULT_WORKSHOP } from "../packages/core/src/workshop";
import {
  changeRoom,
  newRoom,
  ROOM_TTL_MS,
} from "../packages/core/src/shared-room";
import { SharedPlayback } from "../packages/core/src/shared-playback";

const epoch = 1_800_000_000_000;
const launch = (state = newRoom(epoch), now = epoch, id = "launch-0001") =>
  changeRoom(state, { type: "launch", id, revision: state.revision }, now);
const edited = () => {
  const r = structuredClone(DEFAULT_WORKSHOP);
  r.route.altitudeM += 20;
  return r;
};

describe("shared room authority", () => {
  it("rejects a stale competing edit and preserves the accepted setting", () => {
    const initial = newRoom(epoch);
    const first = changeRoom(
      initial,
      { type: "edit", id: "edit-0001", revision: 0, recipe: edited() },
      epoch,
    );
    expect(() =>
      changeRoom(
        first,
        {
          type: "edit",
          id: "edit-0002",
          revision: 0,
          recipe: DEFAULT_WORKSHOP,
        },
        epoch,
      ),
    ).toThrow("相手が先");
    expect(first.draft.route.altitudeM).toBe(260);
    expect(initial.revision).toBe(0);
  });
  it("deduplicates an acknowledged operation even when retried with the old revision", () => {
    const first = launch();
    expect(
      changeRoom(
        first,
        { type: "launch", id: "launch-0001", revision: 0 },
        epoch + 100,
      ),
    ).toBe(first);
    expect(first.flights).toHaveLength(1);
  });
  it.each([
    null,
    {},
    { ...DEFAULT_WORKSHOP, version: 7 },
    { ...DEFAULT_WORKSHOP, flight: { speedMps: 1000, bankResponseSec: 1 } },
  ])("rejects an invalid recipe atomically: %j", (recipe) => {
    const state = launch(),
      before = structuredClone(state);
    expect(() =>
      changeRoom(
        state,
        { type: "edit", id: "edit-0001", revision: 1, recipe },
        epoch,
      ),
    ).toThrow();
    expect(state).toEqual(before);
  });
  it("captures flight snapshots; edits and a queued flight cannot rewrite the active flight", () => {
    const state = launch(),
      first = structuredClone(state.flights[0]);
    const edit = changeRoom(
      state,
      { type: "edit", id: "edit-0001", revision: 1, recipe: edited() },
      first.startsAt + 1,
    );
    const queued = launch(edit, first.startsAt + 100, "launch-0002");
    expect(queued.flights[0]).toEqual(first);
    expect(queued.flights[1].recipe).toEqual(edited());
    expect(queued.flights[1].startsAt).toBe(first.startsAt + 100 + 15000);
    expect(queued.flights[1].startsAt).toBeLessThan(first.endsAt);
    expect(first.clearAt).toBeGreaterThan(first.endsAt);
    expect(() => launch(queued, first.startsAt + 200, "launch-0003")).toThrow(
      "予約済み",
    );
    const cancel = changeRoom(
      queued,
      { type: "cancel-next", id: "cancel-0001", revision: queued.revision },
      first.startsAt + 300,
    );
    expect(cancel.flights).toEqual([first]);
    expect(cancel.draft).toEqual(edited());
  });
  it("expires a room and rejects unsupported operations", () => {
    expect(() => launch(newRoom(epoch), epoch + ROOM_TTL_MS)).toThrow("終了");
    expect(() =>
      changeRoom(
        newRoom(epoch),
        { type: "stop-everyone", id: "unknown-0001", revision: 0 },
        epoch,
      ),
    ).toThrow("対応していない");
  });
  it("bounds retained operation history and completed flights", () => {
    let state = newRoom(epoch);
    for (let n = 0; n < 40; n++)
      state = changeRoom(
        state,
        {
          type: "edit",
          id: `edit-${n.toString().padStart(4, "0")}`,
          revision: state.revision,
          recipe: DEFAULT_WORKSHOP,
        },
        epoch,
      );
    expect(state.recentOperations).toHaveLength(32);
    state = launch(state);
    state = launch(state, state.flights[0].clearAt + 1, "launch-0002");
    expect(state.flights).toHaveLength(1);
    expect(state.flights[0].id).toBe("launch-0002");
  });
});

describe("shared absolute-time playback", () => {
  it("a late join matches an existing observer and consumes old sound without playing it", () => {
    const state = launch(),
      start = state.flights[0].startsAt;
    const a = new Experience(),
      b = new Experience();
    const pa = new SharedPlayback(a, vi.fn()),
      pb = new SharedPlayback(b, vi.fn());
    const arrivalA = vi.fn(),
      arrivalB = vi.fn();
    a.onArrival = arrivalA;
    b.onArrival = arrivalB;
    pa.tick(state, start - 100);
    for (let t = start; t <= start + 30000; t += 100) pa.tick(state, t);
    pb.tick(state, start + 30000);
    expect(a.startAtMs).toBe(start);
    expect(b.pose()).toEqual(a.pose());
    expect(arrivalA.mock.calls.length).toBeGreaterThan(0);
    expect(arrivalB).not.toHaveBeenCalled();
    expect(b.trails).toEqual([]);
    for (let t = start + 30100; t <= start + 35000; t += 100) {
      pa.tick(state, t);
      pb.tick(state, t);
    }
    expect(arrivalB.mock.calls.length).toBeGreaterThan(0);
    expect(b.pose()).toEqual(a.pose());
  });
  it("resting and a disconnected time jump do not replay old audio or stop shared time", () => {
    const state = launch(),
      start = state.flights[0].startsAt;
    const e = new Experience(),
      p = new SharedPlayback(e, vi.fn()),
      arrival = vi.fn();
    e.onArrival = arrival;
    p.tick(state, start);
    for (let t = start + 100; t <= start + 20000; t += 100)
      p.tick(state, t, true);
    expect(arrival).not.toHaveBeenCalled();
    expect(e.nowMs).toBe(start + 20000);
    p.tick(state, start + 30000);
    expect(arrival).not.toHaveBeenCalled();
    p.tick(state, start + 29000);
    expect(e.nowMs).toBe(start + 30000); // A clock correction never rewinds the aircraft.
    for (let t = start + 30100; t < start + 34000; t += 100) p.tick(state, t);
    expect(arrival.mock.calls.length).toBeGreaterThan(0);
  });
  it("switches to the queued snapshot at its start, independent of a newer draft", () => {
    let state = launch();
    const first = state.flights[0];
    state = changeRoom(
      state,
      { type: "edit", id: "edit-0001", revision: 1, recipe: edited() },
      first.startsAt + 1,
    );
    state = launch(state, first.startsAt + 2, "launch-0002");
    const second = state.flights[1];
    state = changeRoom(
      state,
      {
        type: "edit",
        id: "edit-0002",
        revision: state.revision,
        recipe: DEFAULT_WORKSHOP,
      },
      first.startsAt + 3,
    );
    const e = new Experience(),
      p = new SharedPlayback(e, vi.fn());
    p.tick(state, first.startsAt + 10);
    expect(p.flightId).toBe(first.id);
    p.tick(state, second.startsAt + 10);
    expect(p.flightId).toBe(second.id);
    expect(e.pose("ST-02").position.y).toBeGreaterThan(250);
    expect(e.flights).toHaveLength(2);
    expect(e.flights[0].startAtMs).toBe(first.startsAt);
    expect(e.flights[1].startAtMs).toBe(second.startsAt);
  });
  it("cancels the first countdown back to the preview and fails on engine mismatch", () => {
    let state = launch();
    const e = new Experience(),
      p = new SharedPlayback(e, vi.fn());
    p.tick(state, epoch);
    expect(e.phase).toBe("COMPILE");
    state = changeRoom(
      state,
      { type: "cancel-next", id: "cancel-0001", revision: 1 },
      epoch + 100,
    );
    p.tick(state, epoch + 100);
    expect(e.phase).toBe("EDIT");
    expect(p.flightId).toBe(null);
    state = launch(state, epoch + 200, "launch-0002");
    state.flights[0].checksum = "wrong-engine";
    expect(() => p.tick(state, epoch + 300)).toThrow("版が一致");
  });
});
