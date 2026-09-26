import { expect, it } from "vitest";
import { changeRoom, newRoom } from "../packages/core/src/shared-room";
import { withFlightSlots } from "../packages/core/src/traffic";
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
it("keeps a valid sound mix after only ST-02 remains and the sky changes", () => {
  let s = send(newRoom(1000), 1000, "aircraft-one");
  s = send(s, s.flights.at(-1)!.startsAt + 1, "aircraft-two");
  const [a, b] = withFlightSlots(s.flights);
  const e = new Experience(),
    p = new SharedPlayback(e, () => {});
  p.tick(s, b.startsAt + 1000, true);
  p.tick(s, a.clearAt + 1, true);
  expect(e.flightIds).toEqual(["ST-02"]);
  expect(e.focusId).toBe("ST-02");
  // A new departure reloads the sky; this used to throw "Invalid sound mix".
  s = send(s, a.clearAt + 2, "aircraft-three");
  expect(() => p.tick(s, a.clearAt + 3, true)).not.toThrow();
  expect(Object.keys(e.mixGains)).toEqual(e.flightIds);
  // The venue sky empties and the draft preview returns.
  expect(() =>
    p.tick({ ...s, flights: [], revision: s.revision + 1 }, a.clearAt + 4, true),
  ).not.toThrow();
  expect(Object.keys(e.mixGains)).toEqual(e.flightIds);
  expect(() => e.setMix("balanced")).not.toThrow();
});
