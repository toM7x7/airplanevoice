import { expect, it } from "vitest";
import {
  advanceExhibition,
  changeRoom,
  newCloudExhibition,
  nextRoomAlarm,
  sharedFlightRoute,
} from "../packages/core/src/shared-room";
import { automaticCruiseLaps, trafficFacts } from "../packages/core/src/traffic";

it.each([
  [6, 5],
  [24, 20],
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
      expect(facts.occupied).toBeLessThanOrEqual(capacity);
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
