import { ArrivalQueue, createEmissions } from "./acoustics";
import { add, checksum } from "./math";
import type { CompiledRoute, SoundArrival } from "./types";
import type { CompiledShowFlight } from "./show";

export const MAX_AIRCRAFT = 24;
export type FlightId =
  | "ST-01"
  | "ST-02"
  | "ST-03"
  | "ST-04"
  | "ST-05"
  | "ST-06"
  | "ST-07"
  | "ST-08"
  | "ST-09"
  | "ST-10"
  | "ST-11"
  | "ST-12"
  | "ST-13"
  | "ST-14"
  | "ST-15"
  | "ST-16"
  | "ST-17"
  | "ST-18"
  | "ST-19"
  | "ST-20"
  | "ST-21"
  | "ST-22"
  | "ST-23"
  | "ST-24";
export const AIRCRAFT = [
  { id: "ST-01", accent: "#205963", offset: { x: 0, y: 0, z: 0 } },
  { id: "ST-02", accent: "#9b5837", offset: { x: 480, y: 85, z: -420 } },
  { id: "ST-03", accent: "#665397", offset: { x: -560, y: 165, z: -780 } },
  ...Array.from({ length: MAX_AIRCRAFT - 3 }, (_, n) => ({
    id: `ST-${String(n + 4).padStart(2, "0")}` as FlightId,
    accent: ["#205963", "#9b5837", "#665397"][n % 3],
    offset: {
      x: (n % 2 ? -1 : 1) * (700 + n * 120),
      y: 80 + (n % 4) * 60,
      z: -900 - n * 160,
    },
  })),
] as const;
export interface AirspaceConfig {
  aircraftCount: number;
  spacingSec: 0 | 8 | 16;
}
export interface FlightArrival extends SoundArrival {
  flightId: FlightId;
}
export interface FlightPlan {
  id: FlightId;
  accent: string;
  route: CompiledRoute;
  startAtMs: number;
  queue: ArrivalQueue;
  started: boolean;
  ended: boolean;
  arrivedCount: number;
}
export function validAirspace(config: AirspaceConfig): boolean {
  return (
    Number.isInteger(config.aircraftCount) &&
    config.aircraftCount >= 1 &&
    config.aircraftCount <= MAX_AIRCRAFT &&
    [0, 8, 16].includes(config.spacingSec)
  );
}
export function buildAirspace(
  route: CompiledRoute,
  startAtMs: number,
  config: AirspaceConfig,
  delayScale: number,
  show?: CompiledShowFlight[],
  reuse: readonly FlightPlan[] = [],
): FlightPlan[] {
  if (!validAirspace(config) || !Number.isFinite(startAtMs))
    throw new Error("Invalid airspace configuration");
  return AIRCRAFT.slice(0, config.aircraftCount).map((aircraft, index) => {
    // Local comparison lanes. Translation preserves speed, curvature and climb;
    // cap vertical translation for an already-high user route. This is not collision avoidance.
    const offset = {
      ...aircraft.offset,
      y: Math.min(
        aircraft.offset.y,
        Math.max(0, 650 - Math.max(...route.samples.map((s) => s.position.y))),
      ),
    };
    const translated =
      index === 0
        ? route
        : {
            ...route,
            routeId: `${route.routeId}/${aircraft.id}`,
            checksum: checksum(`${route.checksum}/${JSON.stringify(offset)}`),
            samples: route.samples.map((sample) => ({
              ...sample,
              position: add(sample.position, offset),
            })),
          };
    const planned = show?.[index];
    const flownRoute = planned?.route ?? translated;
    const start =
      startAtMs + (planned?.startSec ?? index * config.spacingSec) * 1000;
    // A continuing shared flight keeps its plan; re-sampling long journeys stalls the frame.
    const kept = reuse.find(
      (p) =>
        p.id === (planned?.id ?? aircraft.id) &&
        p.startAtMs === start &&
        p.route.checksum === flownRoute.checksum,
    );
    if (kept) return kept;
    return {
      id: planned?.id ?? aircraft.id,
      accent: aircraft.accent,
      route: flownRoute,
      startAtMs: start,
      queue: new ArrivalQueue(createEmissions(flownRoute, start), delayScale),
      started: false,
      ended: false,
      arrivedCount: 0,
    };
  });
}

export type SoundMixMode = "focus" | "balanced" | "solo";
export function soundMix(
  ids: readonly FlightId[],
  mode: SoundMixMode,
  focus: FlightId,
): Partial<Record<FlightId, number>> {
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => AIRCRAFT.some((a) => a.id === id)) ||
    !ids.includes(focus) ||
    !["focus", "balanced", "solo"].includes(mode)
  )
    throw new Error("Invalid sound mix");
  const weights: number[] = ids.map((id) =>
    mode === "balanced" || id === focus ? 1 : mode === "solo" ? 0 : 0.24,
  );
  const norm = Math.sqrt(weights.reduce((sum, w) => sum + w * w, 0));
  return Object.fromEntries(ids.map((id, i) => [id, weights[i] / norm]));
}
