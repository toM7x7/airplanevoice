import { expect, it } from "vitest";
import {
  advanceExhibition,
  changeRoom,
  newCloudExhibition,
  nextRoomAlarm,
  sharedFlightRoute,
  visitorReserve,
} from "../packages/core/src/shared-room";
import { DEFAULT_WORKSHOP } from "../packages/core/src/workshop";
import { automaticCruiseLaps, trafficFacts } from "../packages/core/src/traffic";

// Automatic flights leave two visitor slots: 6 -> up to 4, 24 -> up to 22.
it.each([
  [6, 3],
  [24, 19],
])(
  "keeps a %i-aircraft sky near its setting instead of emptying behind a landing stream",
  (capacity, steady) => {
    let state = newCloudExhibition(1000),
      now = 1001;
    state = changeRoom(
      state,
      {
        id: "traffic-setting",
        revision: state.revision,
        type: "traffic",
        settings: { capacity, jev: false, objective: "lively" },
      },
      now,
    );
    const airborne: number[] = [];
    while (now < 1001 + 45 * 60_000) {
      now = nextRoomAlarm(state, now);
      state = advanceExhibition(state, now);
      const facts = trafficFacts(state, now);
      expect(facts.occupied).toBeLessThanOrEqual(capacity - visitorReserve(capacity));
      if (now > 1001 + 30 * 60_000) airborne.push(facts.airborne);
    }
    expect(Math.min(...airborne)).toBeGreaterThanOrEqual(steady);
    // Participant launches still use two cruise laps; only automatic flights stay longer.
    expect(state.flights.every((f) => f.cruiseLaps === automaticCruiseLaps(capacity))).toBe(true);
  },
  180_000,
);

it("reserves automatic flights with the same checksum clients compile", () => {
  let state = newCloudExhibition(1000),
    now = 1001;
  state = changeRoom(
    state,
    {
      id: "traffic-setting",
      revision: state.revision,
      type: "traffic",
      settings: { capacity: 24, jev: false, objective: "lively" },
    },
    now,
  );
  while (now < 1001 + 35 * 60_000) {
    now = nextRoomAlarm(state, now);
    state = advanceExhibition(state, now);
  }
  expect(state.flights.some((f) => f.landingDelayMs)).toBe(true);
  for (const f of state.flights.slice(-3))
    expect(f.checksum).toBe(sharedFlightRoute(f).checksum);
}, 180_000);

it("lets a visitor depart about 15 s after pressing in a full 24-aircraft sky", () => {
  let state = newCloudExhibition(1000),
    now = 1001;
  state = changeRoom(
    state,
    {
      id: "traffic-setting",
      revision: state.revision,
      type: "traffic",
      settings: { capacity: 24, jev: false, objective: "lively" },
    },
    now,
  );
  while (now < 1001 + 30 * 60_000) {
    now = nextRoomAlarm(state, now);
    state = advanceExhibition(state, now);
  }
  const waits: number[] = [];
  for (let k = 0; k < 12; k++) {
    const id = `visitor-press-${k}`;
    const before = structuredClone(state.flights.filter((f) => f.startsAt <= now && f.clearAt > now));
    state = changeRoom(
      state,
      {
        type: "create-flight",
        id,
        revision: state.revision,
        entry: { id, name: "visitor", recipe: DEFAULT_WORKSHOP },
      },
      now,
    );
    waits.push((state.flights.find((f) => f.id === id)!.startsAt - now) / 1000);
    // Airborne flights keep their plans; only the visitor is scheduled.
    for (const f of before)
      expect(state.flights.find((g) => g.id === f.id)).toEqual(f);
    const end = now + 3 * 60_000;
    for (;;) {
      const alarm = nextRoomAlarm(state, now);
      if (alarm > end) break;
      now = alarm;
      state = advanceExhibition(state, now);
    }
    now = end;
  }
  waits.sort((a, b) => a - b);
  expect(waits[waits.length >> 1]).toBeLessThanOrEqual(16);
  expect(waits.at(-1)).toBeLessThanOrEqual(35);
}, 180_000);
