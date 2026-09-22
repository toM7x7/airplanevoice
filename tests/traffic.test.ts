import { expect, it, vi } from "vitest";
import {
  changeRoom,
  newCloudExhibition,
  newRoom,
  advanceExhibition,
  nextRoomAlarm,
} from "../packages/core/src/shared-room";
import { DEFAULT_WORKSHOP } from "../packages/core/src/workshop";
import {
  trafficFacts,
  trafficDecision,
  checkedTraffic,
  withFlightSlots,
} from "../packages/core/src/traffic";
import { SharedPlayback } from "../packages/core/src/shared-playback";
import { Experience } from "../packages/core/src/experience";
import {
  aircraftVoiceBudget,
  MAX_AUDIO_VOICES,
} from "../packages/core/src/audio-budget";
import { AIRCRAFT, soundMix } from "../packages/core/src/airspace";
import { parseTrialContext } from "../packages/core/src/ai-trial";

it.each([6, 9, 12])(
  "fills %i aircraft with bounded clocks, independent slots and distinct automatic altitudes",
  (capacity) => {
    let state = newCloudExhibition(1000),
      now = 1001;
    state = changeRoom(
      state,
      {
        id: "traffic-setting",
        revision: state.revision,
        type: "traffic",
        settings: { capacity, jev: false },
      },
      now,
    );
    for (let i = 0; i < 55; i++) {
      const alarm = nextRoomAlarm(state, now);
      expect(alarm).toBeGreaterThan(now);
      now = alarm;
      state = advanceExhibition(state, now);
      const facts = trafficFacts(state, now);
      expect(facts.occupied).toBeLessThanOrEqual(capacity);
      const current = state.flights.filter(
        (f) => f.startsAt <= now && f.clearAt > now,
      );
      for (let a = 0; a < current.length; a++)
        for (let b = a + 1; b < current.length; b++)
          expect(
            Math.abs(
              current[a].recipe.route.altitudeM -
                current[b].recipe.route.altitudeM,
            ),
          ).toBeGreaterThanOrEqual(28);
      expect(new Set(current.flatMap((f) => f.slotIds!)).size).toBe(
        current.length,
      );
      const playback = new SharedPlayback(new Experience(), () => {});
      playback.tick(state, now);
      expect(playback.experience.flightIds.length).toBeLessThanOrEqual(
        capacity,
      );
      expect(
        playback.names.every((f) => AIRCRAFT.some((a) => a.id === f.id)),
      ).toBe(true);
    }
    expect(state.traffic?.capacity).toBe(capacity);
  },
  15000,
); // Simulates 55 authoritative alarms and late joins per capacity.
it("overlaps at least six automatic aircraft instead of waiting for the whole sky to clear", () => {
  let state = newCloudExhibition(1000),
    now = 1000,
    peak = 0;
  for (let i = 0; i < 30; i++) {
    now = nextRoomAlarm(state, now);
    state = advanceExhibition(state, now);
    peak = Math.max(peak, trafficFacts(state, now).airborne);
  }
  expect(peak).toBe(6);
});
it("allows a manual departure to replace the automatic reservation and keeps saved settings", () => {
  const s = newCloudExhibition(1000),
    entry = { id: "my-airplane", name: "そら", recipe: DEFAULT_WORKSHOP };
  const next = changeRoom(
    s,
    { id: "manual-flight", revision: s.revision, type: "create-flight", entry },
    1001,
  );
  expect(next.flights).toHaveLength(1);
  expect(next.flights[0].automatic).toBeUndefined();
  expect(next.flights[0].startsAt).toBe(16001);
  expect(next.flights[0].recipe).toEqual(DEFAULT_WORKSHOP);
  expect(next.hangar![0].recipe).toEqual(DEFAULT_WORKSHOP);
});
it("preserves remaining aircraft identity, sound queues and late-join poses when an older aircraft clears", () => {
  let s = newRoom(1000);
  for (let i = 0; i < 3; i++)
    s = changeRoom(
      s,
      {
        id: `manual-plane-${i}`,
        revision: s.revision,
        type: "create-flight",
        entry: {
          id: `manual-plane-${i}`,
          name: `機体${i}`,
          recipe: DEFAULT_WORKSHOP,
        },
      },
      1000 + i * 17000,
    );
  const e = new Experience(),
    stop = vi.fn(),
    playback = new SharedPlayback(e, stop);
  const time = s.flights[0].clearAt - 10;
  playback.tick(s, time);
  const remaining = e.flights.find((f) => f.id === "ST-02")!;
  playback.tick(s, time + 11);
  expect(e.flights.find((f) => f.id === "ST-02")).toBe(remaining);
  const late = new SharedPlayback(new Experience(), () => {});
  late.tick(s, time + 11);
  expect(late.experience.pose("ST-02")).toEqual(e.pose("ST-02"));
  expect(playback.names.find((f) => f.id === "ST-02")?.name).toBe("機体1");
  expect(stop).toHaveBeenCalledTimes(1);
});
it("reduces capacity without deleting airborne aircraft or changing their routes", () => {
  let s = newCloudExhibition(1000),
    now = 1000;
  while (trafficFacts(s, now).airborne < 6) {
    now = nextRoomAlarm(s, now);
    s = advanceExhibition(s, now);
  }
  const original = structuredClone(s.flights);
  s = changeRoom(
    s,
    {
      id: "reduce-capacity",
      revision: s.revision,
      type: "traffic",
      settings: { capacity: 3, jev: false },
    },
    now,
  );
  s = advanceExhibition(s, now);
  expect(s.flights).toEqual(original);
  expect(nextRoomAlarm(s, now)).toBeGreaterThan(now);
});
it("rejects invalid capacities and overlapping stable identities", () => {
  for (const capacity of [0, 13, Infinity, "6", 3.5])
    expect(() => checkedTraffic({ capacity, jev: true })).toThrow();
  const f = newCloudExhibition(1000).flights[0];
  expect(() => withFlightSlots([f, { ...f, id: "duplicate" }])).toThrow();
});
it("limits every aircraft to a fair audio budget, including aircraft 24", () => {
  const gains = soundMix(
    AIRCRAFT.map((a) => a.id),
    "balanced",
    "ST-01",
  );
  const budgets = AIRCRAFT.map((a) => aircraftVoiceBudget(gains, a.id));
  expect(budgets.every((n) => n >= 1)).toBe(true);
  expect(budgets.reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(
    MAX_AUDIO_VOICES,
  );
  expect(aircraftVoiceBudget({}, "ST-01")).toBe(0);
});
it("expires old Jev decisions and does not use them when the operator turns Jev off", () => {
  const state = newCloudExhibition(1000);
  state.traffic!.jev = true;
  state.trafficDecision = {
    at: 1000,
    source: "jev",
    pace: "quiet",
    note: "混雑中",
  };
  expect(trafficDecision(state, 5000).source).toBe("jev");
  expect(trafficDecision(state, 100000).source).toBe("rules");
  state.traffic!.jev = false;
  expect(trafficDecision(state, 5000).source).toBe("rules");
});
it("accepts a named 24-aircraft context for Live and Jev", () => {
  const parsed = parseTrialContext({
    revision: 1,
    phase: "FLY",
    paused: false,
    volume: 35,
    soundOn: true,
    menuOpen: false,
    menuPage: "home",
    selected: false,
    fleet: AIRCRAFT.map((a) => ({
      id: a.id,
      name: `名前 ${a.id}`,
      state: "flying",
      distanceM: 500,
      pendingCount: 2,
    })),
  });
  expect(parsed.fleet).toHaveLength(24);
});
