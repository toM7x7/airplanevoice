import { expect, it } from "vitest";
import { overheadRecipe } from "../packages/core/src/overhead";
import {
  checkedWorkshop,
  newRoom,
  changeRoom,
  advanceExhibition,
} from "../packages/core/src/shared-room";
import { SharedPlayback } from "../packages/core/src/shared-playback";
import { Experience } from "../packages/core/src/experience";
import { DEFAULT_WORKSHOP, parseWorkshop } from "../packages/core/src/workshop";
import { engineSignal } from "../apps/desktop/src/engine-sound";

it("places the compiled route above the observer without scaling the aircraft", () => {
  for (const observer of [
    { x: 0, y: 1.7, z: 0 },
    { x: 420, y: 70, z: 250 },
  ]) {
    const recipe = overheadRecipe(observer);
    const route = checkedWorkshop(recipe).route;
    const near = route.samples.reduce((a, b) =>
      Math.hypot(a.position.x - observer.x, a.position.z - observer.z) <
      Math.hypot(b.position.x - observer.x, b.position.z - observer.z)
        ? a
        : b,
    );
    expect(
      Math.hypot(near.position.x - observer.x, near.position.z - observer.z),
    ).toBeLessThan(5);
    expect(near.position.y - observer.y).toBeGreaterThan(180);
    expect(recipe.aircraft).toEqual(DEFAULT_WORKSHOP.aircraft);
  }
});
it("round trips sound and rejects out of range input while accepting old recipes", () => {
  expect(parseWorkshop(JSON.stringify(DEFAULT_WORKSHOP))).toEqual(
    DEFAULT_WORKSHOP,
  );
  const r = structuredClone(DEFAULT_WORKSHOP);
  r.aircraft.sound = { body: 1, fan: 0, air: 0 };
  expect(parseWorkshop(JSON.stringify(r))).toEqual(r);
  r.aircraft.sound.body = 2;
  expect(() => parseWorkshop(JSON.stringify(r))).toThrow();
  const low = engineSignal(8000, 4, 1, { body: 1, fan: 0, air: 0 });
  const fan = engineSignal(8000, 4, 1, { body: 0, fan: 1, air: 1 });
  expect(low).not.toEqual(fan);
  for (const data of [low, fan])
    expect(Math.max(...data.map(Math.abs))).toBeLessThan(1);
});
it("shares three independent aircraft and rotates the next group without mutating the active flight", () => {
  let room = newRoom(1000, true),
    n = 0;
  const send = (op: object, now = 1000) =>
    (room = changeRoom(
      room,
      { ...op, id: `operation-${++n}`, revision: room.revision },
      now,
    ));
  for (let i = 0; i < 4; i++)
    send({
      type: "hangar-save",
      entry: {
        id: `aircraft-${i}`,
        name: `旅客機${i}`,
        recipe: {
          ...DEFAULT_WORKSHOP,
          aircraft: {
            ...DEFAULT_WORKSHOP.aircraft,
            bodyLengthM: 60 + i,
            sound: { body: i / 4, fan: 0.5, air: 0.3 },
          },
        },
      },
    });
  send({ type: "launch-hangar" });
  expect(room.flights[0].names).toEqual(["旅客機0", "旅客機1", "旅客機2"]);
  const saved = JSON.stringify(room.flights[0]);
  send({ type: "hangar-remove", entryId: "aircraft-1" });
  expect(JSON.stringify(room.flights[0])).toBe(saved);
  const a = new Experience(),
    b = new Experience();
  new SharedPlayback(a, () => {}).tick(room, room.flights[0].startsAt + 25000);
  new SharedPlayback(b, () => {}).tick(room, room.flights[0].startsAt + 25000);
  expect(a.flightIds).toHaveLength(3);
  expect(a.designFor("ST-02").bodyLengthM).toBe(61);
  expect(a.pose()).toEqual(b.pose());
  send({ type: "repeat", enabled: true });
  expect(room.exhibition?.source).toBe("hangar");
  room = advanceExhibition(room, room.flights[0].clearAt + 1);
  expect(room.flights[0].names).toHaveLength(3);
  expect(room.flights[0].names).not.toContain("旅客機1");
});

it("rotates four saved aircraft in three-aircraft batches and bounds collection size", () => {
  let room = newRoom(1000, true),
    n = 0;
  const send = (op: object) =>
    (room = changeRoom(
      room,
      { ...op, id: `operation-${++n}`, revision: room.revision },
      1000,
    ));
  for (let i = 0; i < 24; i++)
    send({
      type: "hangar-save",
      entry: {
        id: `aircraft-${i}`,
        name: `機体${i}`,
        recipe: DEFAULT_WORKSHOP,
      },
    });
  expect(() =>
    send({
      type: "hangar-save",
      entry: { id: "aircraft-24", name: "超過", recipe: DEFAULT_WORKSHOP },
    }),
  ).toThrow();
  for (let i = 4; i < 24; i++)
    send({ type: "hangar-remove", entryId: `aircraft-${i}` });
  send({ type: "launch-hangar" });
  send({ type: "repeat", enabled: true });
  room = advanceExhibition(room, room.flights[0].clearAt + 1);
  expect(room.flights[0].names).toEqual(["機体3", "機体0", "機体1"]);
});
