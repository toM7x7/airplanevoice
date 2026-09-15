import { AIRCRAFT, type FlightId } from "./airspace";
import { compileRoute } from "./route";
import { checksum, distance } from "./math";
import {
  DEFAULT_WORKSHOP,
  parseWorkshop,
  workshopSpec,
  type WorkshopRecipe,
} from "./workshop";
import type { CompiledRoute, Vec3 } from "./types";

export interface ShowFlight {
  startSec: number;
  recipe: WorkshopRecipe;
}
export interface ShowRecipe {
  version: 1;
  title: string;
  flights: ShowFlight[];
}
export interface CompiledShowFlight extends ShowFlight {
  id: FlightId;
  route: CompiledRoute;
}

export function compileShow(input: unknown) {
  const s = input as ShowRecipe;
  if (
    !s ||
    s.version !== 1 ||
    typeof s.title !== "string" ||
    !s.title.trim() ||
    s.title.length > 48 ||
    !Array.isArray(s.flights) ||
    s.flights.length < 1 ||
    s.flights.length > 3
  )
    throw new Error("演目名と1〜3機の予定を確認してください。");
  const flights: CompiledShowFlight[] = s.flights.map((f, i) => {
    if (
      !f ||
      !Number.isFinite(f.startSec) ||
      f.startSec < 0 ||
      f.startSec > 180 ||
      (i === 0 && f.startSec !== 0)
    )
      throw new Error("先頭機は0秒、ほかの機体は0〜180秒で開始してください。");
    const recipe = parseWorkshop(JSON.stringify(f.recipe));
    const route = compileRoute(workshopSpec(recipe, 1));
    return { id: AIRCRAFT[i].id, startSec: f.startSec, recipe, route };
  });
  const recipe: ShowRecipe = {
    version: 1,
    title: s.title.trim(),
    flights: flights.map(({ startSec, recipe }) => ({ startSec, recipe })),
  };
  return {
    recipe,
    flights,
    durationMs: Math.max(
      ...flights.map((f) => f.startSec * 1000 + f.route.durationMs),
    ),
    checksum: checksum({
      recipe,
      routes: flights.map((f) => f.route.checksum),
    }),
  };
}

export const AIRCRAFT_PATTERNS = [
  {
    name: "ゆったり四発",
    aircraft: { bodyLengthM: 71, wingSpanM: 64, engineCount: 4 as const },
  },
  {
    name: "長い翼の双発",
    aircraft: { bodyLengthM: 62, wingSpanM: 72, engineCount: 2 as const },
  },
  {
    name: "大きな四発",
    aircraft: { bodyLengthM: 82, wingSpanM: 78, engineCount: 4 as const },
  },
];
export const ROUTE_PATTERNS = [
  {
    name: "正面のフライバイ",
    route: {
      ...DEFAULT_WORKSHOP.route,
      altitudeM: 220,
      widthM: 1000,
      variation: 0.15,
    },
    flight: { speedMps: 52, bankResponseSec: 1.6 },
  },
  {
    name: "斜めの往復",
    route: {
      ...DEFAULT_WORKSHOP.route,
      a: { x: -1300, z: -2100 },
      b: { x: 1100, z: -900 },
      widthM: 1100,
      altitudeM: 320,
      seed: 31,
    },
    flight: { speedMps: 58, bankResponseSec: 1.8 },
  },
  {
    name: "低く、ゆっくり",
    route: {
      ...DEFAULT_WORKSHOP.route,
      altitudeM: 160,
      variation: 0.1,
      seed: 13,
    },
    flight: { speedMps: 42, bankResponseSec: 2 },
  },
  {
    name: "高い大回り",
    route: {
      ...DEFAULT_WORKSHOP.route,
      a: { x: -1400, z: -2000 },
      b: { x: 1400, z: -2000 },
      widthM: 1250,
      altitudeM: 440,
      seed: 23,
    },
    flight: { speedMps: 64, bankResponseSec: 2 },
  },
];
export const SHOW_PATTERNS = [
  "交互に見上げる",
  "双発と四発を聴き比べる",
  "三つの高さ",
] as const;
export function showPattern(index = 0): ShowRecipe {
  const flight = (
    route: number,
    aircraft: number,
    startSec: number,
  ): ShowFlight => ({
    startSec,
    recipe: structuredClone({
      version: 1,
      aircraft: AIRCRAFT_PATTERNS[aircraft].aircraft,
      ...ROUTE_PATTERNS[route],
    }),
  });
  // Remove the display-only name from the strictly validated workshop recipe.
  const clean = (f: ShowFlight) => ({
    ...f,
    recipe: {
      version: 1 as const,
      aircraft: f.recipe.aircraft,
      route: f.recipe.route,
      flight: f.recipe.flight,
    },
  });
  const flights =
    index === 1
      ? [flight(0, 1, 0), flight(0, 0, 30)]
      : index === 2
        ? [flight(2, 1, 0), flight(1, 0, 18), flight(3, 2, 40)]
        : [flight(0, 0, 0), flight(1, 1, 16)];
  return {
    version: 1,
    title: SHOW_PATTERNS[index] ?? SHOW_PATTERNS[0],
    flights: flights.map(clean),
  };
}

// Approximate closest pass for a stationary observation point; not measured sound pressure.
export function closestPass(
  route: CompiledRoute,
  listener: Vec3,
  startSec = 0,
  delayScale = 1.6,
) {
  let nearest = 0,
    distanceM = Infinity;
  route.samples.forEach((s, i) => {
    const d = distance(s.position, listener);
    if (d < distanceM) {
      distanceM = d;
      nearest = i;
    }
  });
  const passSec =
    startSec + ((nearest / route.samples.length) * route.durationMs) / 1000;
  return {
    passSec,
    soundSec: passSec + (distanceM / 343) * delayScale,
    distanceM,
    position: route.samples[nearest].position,
  };
}
