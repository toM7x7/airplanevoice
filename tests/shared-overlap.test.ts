import { expect, it, vi } from "vitest";
import {
  changeRoom,
  newRoom,
  checkedWorkshop,
} from "../packages/core/src/shared-room";
import { DEFAULT_WORKSHOP } from "../packages/core/src/workshop";
import { SharedPlayback } from "../packages/core/src/shared-playback";
import { Experience } from "../packages/core/src/experience";
const send = (state: ReturnType<typeof newRoom>, now: number, id: string) =>
  changeRoom(
    state,
    {
      type: "create-flight",
      id,
      revision: state.revision,
      entry: { id, name: id, recipe: DEFAULT_WORKSHOP },
    },
    now,
  );
it("keeps the first aircraft and its audio queue while a second takes off after 15 seconds", () => {
  let s = send(newRoom(1000), 1000, "aircraft-one");
  const a = s.flights[0],
    e = new Experience(),
    stop = vi.fn(),
    p = new SharedPlayback(e, stop);
  p.tick(s, a.startsAt + 1000);
  const queue = e.flights[0].queue;
  s = send(s, a.startsAt + 1000, "aircraft-two");
  const b = s.flights[1];
  expect(b.startsAt).toBe(a.startsAt + 16000);
  expect(a.endsAt - a.startsAt).toBeGreaterThan(
    checkedWorkshop(DEFAULT_WORKSHOP).route.durationMs * 2,
  );
  p.tick(s, a.startsAt + 1100);
  expect(e.flights[0].queue).toBe(queue);
  p.tick(s, b.startsAt + 9000);
  expect(e.flights.filter((f) => f.started && !f.ended)).toHaveLength(2);
  const late = new SharedPlayback(new Experience(), () => {});
  late.tick(s, b.startsAt + 9000);
  expect(late.experience.pose("ST-01")).toEqual(e.pose("ST-01"));
  expect(late.experience.pose("ST-02")).toEqual(e.pose("ST-02"));
  expect(stop).toHaveBeenCalledTimes(1);
});
it("reserves three aircraft including audio tails and queues a fourth without erasing ongoing flights", () => {
  let s = send(newRoom(1000), 1000, "aircraft-one");
  s = send(s, s.flights.at(-1)!.startsAt + 1, "aircraft-two");
  s = send(s, s.flights.at(-1)!.startsAt + 1, "aircraft-three");
  const previous = structuredClone(s.flights);
  s = send(s, s.flights.at(-1)!.startsAt + 1, "aircraft-four");
  expect(s.flights.slice(0, 3)).toEqual(previous);
  expect(s.flights[3].startsAt).toBeGreaterThanOrEqual(previous[0].clearAt); // Also reserve an empty runway between arrivals.
  const p = new SharedPlayback(new Experience(), () => {});
  p.tick(s, s.flights[2].startsAt + 1);
  expect(p.experience.flights).toHaveLength(3);
  p.tick(s, s.flights[3].startsAt + 1);
  expect(p.experience.flights).toHaveLength(s.flights.filter(f=>f.clearAt>s.flights[3].startsAt+1).length);
});
