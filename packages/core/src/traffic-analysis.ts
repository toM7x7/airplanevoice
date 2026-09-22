import { compileRoute } from "./route";
import { workshopSpec, type WorkshopRecipe } from "./workshop";
import { DEPARTURE_MS, withRunwayDeparture } from "./departure";
import type { RoomState } from "./shared-room";
import type { Vec3 } from "./types";
import { flightJourney, instructedRoute } from "./flight-journey";
import { flightPose } from "./flight";

// Bounded cache: forecasts run on room events, never on the rendering clock.
const routes = new Map<string, ReturnType<typeof compileRoute>>();
const journeys = new Map<string, ReturnType<typeof compileRoute>>();
function route(recipe: WorkshopRecipe) {
  const key = JSON.stringify(recipe);
  if (!routes.has(key)) {
    if (routes.size >= 36) routes.delete(routes.keys().next().value!);
    routes.set(key, compileRoute(workshopSpec(recipe, 0)));
  }
  return routes.get(key)!;
}
export function trafficPlans(state: RoomState, now: number) {
  return state.flights
    .filter((f) => f.clearAt > now)
    .flatMap((f) =>
      (f.show?.flights ?? [{ recipe: f.recipe, startSec: 0 }]).map((p, i) => {
        const base = route(p.recipe),
          full = f.journey === 2 || !!f.instructions?.length,
          startsAt = f.startsAt + p.startSec * 1000;
        if(full && !journeys.has(f.checksum)) {
          if(journeys.size>=96) journeys.delete(journeys.keys().next().value!);
          journeys.set(f.checksum,instructedRoute(f.journey === 2 ? flightJourney(base,f.cruiseLaps??2,f.landingDelayMs) : f.departure ? withRunwayDeparture(base,f.cruiseLaps??1):base,f.instructions));
        }
        const r=full?journeys.get(f.checksum)!:base;
        const cruiseAt = startsAt + (full ? 0 : f.departure ? DEPARTURE_MS : 0);
        return {
          name: f.names?.[i] ?? "旅客機",
          altitudeM: p.recipe.route.altitudeM,
          speedMps: p.recipe.flight.speedMps,
          r,
          startsAt,
          cruiseAt,
          endsAt: Math.min(
            f.endsAt,
            cruiseAt + r.durationMs * (f.cruiseLaps ?? 1),
          ),
        };
      }),
    );
}
export function trafficAssessment(state: RoomState, now: number) {
  const plans = trafficPlans(state, now);
  const position = (p: (typeof plans)[number], at: number): Vec3 | null => {
    if (at < p.cruiseAt || at >= p.endsAt) return null;
    return flightPose(p.r,at-p.cruiseAt).position;
  };
  let nearest: { names: string[]; distanceM: number; inSec: number } | null =
    null;
  const close = new Set<string>();
  for (let sec = 0; sec <= 30; sec += 3) {
    const points = plans.map((p) => position(p, now + sec * 1000));
    for (let a = 0; a < points.length; a++)
      for (let b = a + 1; b < points.length; b++) {
        const x = points[a],
          y = points[b];
        if (!x || !y) continue;
        const d = Math.hypot(x.x - y.x, x.y - y.y, x.z - y.z);
        if (!nearest || d < nearest.distanceM)
          nearest = {
            names: [plans[a].name, plans[b].name],
            distanceM: d,
            inSec: sec,
          };
        if (d < 180) close.add(`${a}:${b}`);
      }
  }
  // A fixed ground-origin proxy, distinct from each visitor's actual volume and listening position.
  const audible = plans.filter((p) => {
    const current = position(p, now);
    if (!current) return false;
    const delay =
      (Math.hypot(current.x, current.y - 1.7, current.z) / 343) * 1000;
    const emission = position(p, now - delay);
    return (
      emission && Math.hypot(emission.x, emission.y - 1.7, emission.z) < 1200
    );
  }).length;
  return {
    at: now,
    horizonSec: 30,
    sampleStepSec: 3,
    closePairs: close.size,
    nearest: nearest
      ? { ...nearest, distanceM: Math.round(nearest.distanceM) }
      : null,
    soundOverlap: audible,
    reference: "地上の原点・半径1200m。音圧ではなく巡航機の重なりの目安。",
    scope:
      "新しい便は離着陸と航路変更も含む。3秒ごとの近接の目安。厳密な衝突回避ではない。旧便は巡航のみ。",
  };
}
