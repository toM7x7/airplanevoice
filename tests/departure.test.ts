import { expect, it } from "vitest";
import {
  withRunwayDeparture,
  DEPARTURE_MS,
} from "../packages/core/src/departure";
import {
  checkedWorkshop,
  newRoom,
  changeRoom,
} from "../packages/core/src/shared-room";
import { DEFAULT_WORKSHOP } from "../packages/core/src/workshop";
import { Experience } from "../packages/core/src/experience";
import { SharedPlayback } from "../packages/core/src/shared-playback";
it("rolls on the runway, climbs and joins the authored route without a position jump", () => {
  const base = checkedWorkshop(DEFAULT_WORKSHOP).route,
    route = withRunwayDeparture(base);
  expect(route.samples[0].position).toEqual({ x: -200, y: 8.5, z: -180 });
  expect(route.durationMs).toBe(base.durationMs + DEPARTURE_MS);
  expect(
    route.samples.filter((_, i) => i < 70).every((s) => s.position.y === 8.5),
  ).toBe(true);
  const join = Math.floor(
    (DEPARTURE_MS / route.durationMs) * route.samples.length,
  );
  expect(route.samples[join].position.y).toBeGreaterThan(100);
  const jumps = route.samples
    .slice(1)
    .map((s, i) =>
      Math.hypot(
        s.position.x - route.samples[i].position.x,
        s.position.y - route.samples[i].position.y,
        s.position.z - route.samples[i].position.z,
      ),
    );
  expect(Math.max(...jumps)).toBeLessThan(25);
});
it("two clients share the same takeoff and the server reserves the added time", () => {
  const state = changeRoom(
    newRoom(1000),
    {
      type: "create-flight",
      id: "departure-test",
      revision: 0,
      entry: { id: "my-aircraft", name: "そら", recipe: DEFAULT_WORKSHOP },
    },
    1000,
  );
  const flight = state.flights[0];
  expect(flight.departure).toBe(true);
  const a = new SharedPlayback(new Experience(), () => {}),
    b = new SharedPlayback(new Experience(), () => {});
  a.tick(state, flight.startsAt + 4000);
  b.tick(state, flight.startsAt + 4000);
  expect(a.experience.pose()).toEqual(b.experience.pose());
  expect(a.experience.pose().position.y).toBeCloseTo(8.5);
  expect(flight.endsAt - flight.startsAt).toBeCloseTo(
    a.experience.route.durationMs,
  );
});
