import { it, expect } from "vitest";
import {
  changeRoom,
  newRoom,
  checkedWorkshop,
  sharedFlightRoute,
} from "../packages/core/src/shared-room";
import { DEFAULT_WORKSHOP } from "../packages/core/src/workshop";
import { flightJourney, ARRIVAL_MS } from "../packages/core/src/flight-journey";
import { flightPose } from "../packages/core/src/flight";
import { Experience } from "../packages/core/src/experience";
import { SharedPlayback } from "../packages/core/src/shared-playback";
import { soundMix } from "../packages/core/src/airspace";
const initial = () =>
  changeRoom(
    newRoom(1000),
    {
      id: "journey-aircraft",
      revision: 0,
      type: "create-flight",
      entry: { id: "my-aircraft", name: "そら", recipe: DEFAULT_WORKSHOP },
    },
    1000,
  );
it("lands, decelerates and reaches the hangar without wrapping to the departure point", () => {
  const r = flightJourney(checkedWorkshop(DEFAULT_WORKSHOP).route),
    a = r.durationMs - ARRIVAL_MS;
  expect(flightPose(r, a + 80000).position.y).toBeCloseTo(8.5, 1);
  expect(flightPose(r, r.durationMs).position).toEqual({
    x: -120,
    y: 8.5,
    z: -350,
  });
  expect(flightPose(r, r.durationMs + 10000).position).toEqual(
    flightPose(r, r.durationMs).position,
  );
  const gaps = r.samples
    .slice(1)
    .map((s, i) =>
      Math.hypot(
        s.position.x - r.samples[i].position.x,
        s.position.y - r.samples[i].position.y,
        s.position.z - r.samples[i].position.z,
      ),
    );
  expect(Math.max(...gaps)).toBeLessThan(30);
  expect(
    Math.min(...r.samples.map((s) => s.position.y)),
  ).toBeGreaterThanOrEqual(8.4);
});
it("prioritises 15s departures and extends cruise to separate runway arrivals", () => {
  let s = initial();
  s = changeRoom(
    s,
    {
      id: "journey-second",
      revision: s.revision,
      type: "create-flight",
      entry: { id: "other-plane", name: "かなた", recipe: DEFAULT_WORKSHOP },
    },
    1001,
  );
  expect(s.flights[1].startsAt - s.flights[0].startsAt).toBe(15000);
  expect(s.flights[1].landingDelayMs).toBeGreaterThan(0);
  expect(s.flights[1].endsAt - s.flights[0].endsAt).toBeGreaterThanOrEqual(
    50000,
  );
  for (const f of s.flights)
    expect(sharedFlightRoute(f).durationMs).toBeCloseTo(
      f.endsAt - f.startsAt,
      3,
    );
});
it("shares a smooth overhead instruction without moving past sound or another saved design", () => {
  const s = initial(),
    f = s.flights[0],
    now = f.startsAt + 40000;
  const e = new Experience(),
    p = new SharedPlayback(e, () => {});
  p.tick(s, now);
  const oldQueue = e.flights[0].queue,
    emitted = oldQueue.emissions
      .filter((e) => e.emitAtMs <= now)
      .map((e) => ({ ...e }));
  const original = JSON.stringify(s.hangar);
  const next = changeRoom(
    s,
    {
      id: "overhead-command",
      revision: s.revision,
      type: "flight-instruction",
      flightId: f.id,
      instruction: "overhead",
      observer: { x: 0, z: 0 },
    },
    now,
  );
  expect(JSON.stringify(next.hangar)).toBe(original);
  const c = next.flights[0].instructions![0],
    route = sharedFlightRoute(next.flights[0]);
  const centre = flightPose(route, (c.fromMs + c.untilMs) / 2).position;
  expect(Math.hypot(centre.x, centre.z)).toBeLessThan(0.2);
  for (const t of [0, 4000, now - f.startsAt, c.untilMs + 5000])
    expect(flightPose(route, t).position).toEqual(
      flightPose(sharedFlightRoute(f), t).position,
    );
  p.tick(next, now + 100);
  expect(e.flights[0].queue).toBe(oldQueue);
  expect(oldQueue.emissions.filter((e) => e.emitAtMs <= now)).toEqual(emitted);
  const late = new SharedPlayback(new Experience(), () => {});
  late.tick(next, now + 20000);
  p.tick(next, now + 20000);
  expect(late.experience.pose()).toEqual(e.pose());
  expect(() =>
    changeRoom(
      next,
      {
        id: "overhead-repeat",
        revision: next.revision,
        type: "flight-instruction",
        flightId: f.id,
        instruction: "wide",
        observer: { x: 0, z: 0 },
      },
      now + 1000,
    ),
  ).toThrow(/指示に沿って/);
});
it("rejects close future passes, expired targets and invalid destinations", () => {
  const s = initial(),
    f = s.flights[0],
    now = f.startsAt + 40000;
  const base = {
    id: "command-denied",
    revision: s.revision,
    type: "flight-instruction",
    flightId: f.id,
    instruction: "wide",
    observer: { x: 0, z: 0 },
  };
  const other = structuredClone(f);
  other.id = "other-flight";
  other.slotIds = ["ST-02"];
  s.flights.push(other);
  expect(() => changeRoom(s, base, now)).toThrow(/近い機体/);
  expect(() =>
    changeRoom(s, { ...base, observer: { x: Infinity, z: 0 } }, now),
  ).toThrow(/観察位置/);
  expect(() => changeRoom(s, base, f.endsAt - 1000)).toThrow(/巡航中/);
});
it("solo silences all other aircraft while balanced restores their gains", () => {
  expect(soundMix(["ST-01", "ST-02", "ST-03"], "solo", "ST-02")).toEqual({
    "ST-01": 0,
    "ST-02": 1,
    "ST-03": 0,
  });
  expect(
    Object.values(
      soundMix(["ST-01", "ST-02", "ST-03"], "balanced", "ST-02"),
    ).every((g) => g! > 0),
  ).toBe(true);
});
