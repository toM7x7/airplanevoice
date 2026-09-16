import { describe, expect, it } from "vitest";
import { changeRoom, newRoom } from "../packages/core/src/shared-room";
import {
  observeRoom,
  describeRoom,
} from "../packages/core/src/room-observation";

const epoch = 1_800_000_000_000;
const initial = newRoom(epoch);
const launched = changeRoom(
  initial,
  { id: "launch-0001", type: "launch", revision: 0 },
  epoch,
);
const first = launched.flights[0];

describe("shared tower facts", () => {
  it("distinguishes a preview, pending departure, flight, delayed sound, and a completed flight", () => {
    expect(observeRoom(initial, epoch, true).phase).toBe("idle");
    expect(observeRoom(launched, first.startsAt - 1, true).phase).toBe(
      "scheduled",
    );
    expect(observeRoom(launched, first.startsAt, true).phase).toBe("flying");
    const arrival = observeRoom(launched, first.endsAt, true);
    expect(arrival.phase).toBe("arrival");
    expect(describeRoom(arrival).title).toContain("遅れて届く音");
    expect(describeRoom(arrival).spoken).not.toContain("飛行中");
    expect(observeRoom(launched, first.clearAt, true).current).toBeNull();
  });
  it("does not describe an edited draft as the plane that is already flying or reserved", () => {
    const queued = changeRoom(
      launched,
      { id: "launch-0002", type: "launch", revision: 1 },
      first.startsAt,
    );
    const draft = structuredClone(queued.draft);
    draft.route.altitudeM = 320;
    const edited = changeRoom(
      queued,
      { id: "editing-0003", type: "edit", recipe: draft, revision: 2 },
      first.startsAt,
    );
    const facts = observeRoom(edited, first.startsAt, true);
    expect(facts.current?.settings.altitudeM).toBe(
      first.recipe.route.altitudeM,
    );
    expect(facts.next?.settings.altitudeM).toBe(first.recipe.route.altitudeM);
    expect(facts.draft?.altitudeM).toBe(320);
    expect(describeRoom(facts).lines).toHaveLength(4);
    expect(launched.draft.route.altitudeM).not.toBe(320);
  });
  it("does not pretend stale disconnected data is a verified current schedule", () => {
    const facts = observeRoom(launched, first.startsAt, false);
    expect(facts.phase).toBe("offline");
    expect(facts.current).toBeNull();
    expect(facts.next).toBeNull();
    expect(facts.draft).toBeNull();
    expect(describeRoom(facts).title).toContain("確認できません");
  });
  it("removes the schedule at room expiry and accepts an absent room", () => {
    expect(observeRoom(launched, launched.expiresAt, true).phase).toBe(
      "expired",
    );
    expect(observeRoom(null, epoch, true).phase).toBe("no-room");
  });
  it("labels repetition as a plan without inventing a reserved flight", () => {
    const state = { ...initial, exhibition: { repeat: true } };
    const facts = observeRoom(state, epoch, true);
    expect(facts.next).toBeNull();
    expect(describeRoom(facts).lines.join()).toContain("自動で準備");
    expect(describeRoom(facts).spoken).not.toMatch(/あと.*秒/);
  });
  it("exports only whitelisted facts and does not mutate the room", () => {
    const state = Object.assign(structuredClone(launched), {
      privateKey: "never-export",
    });
    const before = structuredClone(state);
    const facts = observeRoom(state, first.startsAt, true);
    expect(JSON.stringify(facts)).not.toContain("never-export");
    expect(JSON.stringify(facts)).not.toContain("recentOperations");
    expect(state).toEqual(before);
  });
});
