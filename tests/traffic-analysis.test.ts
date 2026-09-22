import { expect, it } from "vitest";
import {
  newCloudExhibition,
  advanceExhibition,
  checkedWorkshop,
} from "../packages/core/src/shared-room";
import { DEFAULT_WORKSHOP } from "../packages/core/src/workshop";
import { trafficAssessment } from "../packages/core/src/traffic-analysis";
import {
  trafficFacts,
  recordTraffic,
  cruiseAltitudeCandidates,
} from "../packages/core/src/traffic";
const fixture = () => {
  const s = newCloudExhibition(1000),
    recipe = structuredClone(DEFAULT_WORKSHOP),
    r = checkedWorkshop(recipe).route;
  s.flights = [
    {
      id: "one",
      recipe,
      startsAt: 1000,
      endsAt: 1000 + r.durationMs,
      clearAt: 6000 + r.durationMs,
      checksum: r.checksum,
      names: ["みなと"],
    },
    {
      id: "two",
      recipe: structuredClone(recipe),
      startsAt: 1000,
      endsAt: 1000 + r.durationMs,
      clearAt: 6000 + r.durationMs,
      checksum: r.checksum,
      names: ["そら"],
    },
  ];
  return s;
};
it("identifies coincident cruise routes using the saved names and skips departure motion", () => {
  const s = fixture();
  const result = trafficAssessment(s, 9000);
  expect(result.closePairs).toBe(1);
  expect(result.nearest).toMatchObject({
    names: ["みなと", "そら"],
    distanceM: 0,
  });
  s.flights.forEach((f) => {
    f.departure = true;
    f.startsAt = 20000;
  });
  expect(trafficAssessment(s, 9000).nearest).toBeNull();
});
it("excludes expired and distant-altitude flights and handles the end of a route", () => {
  const s = fixture();
  s.flights[1].recipe.route.altitudeM = 500;
  s.flights[0].recipe.route.altitudeM = 140;
  expect(trafficAssessment(s, 9000).closePairs).toBe(0);
  expect(trafficAssessment(s, s.flights[0].clearAt + 50000)).toMatchObject({
    nearest: null,
    closePairs: 0,
    soundOverlap: 0,
  });
});
it("counts each show aircraft with its own departure time", () => {
  const s = fixture();
  s.flights = s.flights.slice(0, 1);
  s.flights[0].show = {
    version: 1,
    title: "fixture",
    flights: [
      { recipe: DEFAULT_WORKSHOP, startSec: 0 },
      { recipe: DEFAULT_WORKSHOP, startSec: 30 },
    ],
  };
  expect(trafficFacts(s, 9000)).toMatchObject({
    airborne: 1,
    waiting: 1,
    occupied: 2,
  });
});
it("offers separated future altitudes and does not edit existing flights or saved recipes", () => {
  const s = fixture(),
    before = JSON.stringify(s.flights);
  const candidates = cruiseAltitudeCandidates(s, 200, 20000);
  expect(candidates.near).not.toBeNull();
  expect(candidates.spread).not.toBeNull();
  expect(
    Math.abs(candidates.spread! - s.flights[0].recipe.route.altitudeM),
  ).toBeGreaterThanOrEqual(
    Math.abs(candidates.near! - s.flights[0].recipe.route.altitudeM),
  );
  s.traffic!.jev = true;
  s.trafficDecision = {
    at: 20000,
    source: "jev",
    pace: "flow",
    altitude: "spread",
    note: "fixture",
  };
  const next = advanceExhibition(s, 20000);
  expect(JSON.stringify(s.flights)).toBe(before);
  expect(next.trafficHistory?.at(-1)).toMatchObject({
    status: "applied",
    source: "jev",
    altitudeM: candidates.spread,
  });
});
it("bounds the audit history so recurring automation cannot grow room messages indefinitely", () => {
  const s = fixture();
  for (let i = 0; i < 100; i++)
    recordTraffic(s, {
      at: i,
      source: "rules",
      status: "applied",
      note: `entry ${i}`,
    });
  expect(s.trafficHistory).toHaveLength(20);
  expect(s.trafficHistory![0].at).toBe(80);
});
