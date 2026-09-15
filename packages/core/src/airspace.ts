import { ArrivalQueue, createEmissions } from "./acoustics";
import { add, checksum } from "./math";
import type { CompiledRoute, SoundArrival } from "./types";
import type { CompiledShowFlight } from "./show";

export const AIRCRAFT = [
  { id: "ST-01", accent: "#205963", offset: { x: 0, y: 0, z: 0 } },
  { id: "ST-02", accent: "#9b5837", offset: { x: 480, y: 85, z: -420 } },
  { id: "ST-03", accent: "#665397", offset: { x: -560, y: 165, z: -780 } },
] as const;
export type FlightId = (typeof AIRCRAFT)[number]["id"];
export interface AirspaceConfig {
  aircraftCount: 1 | 2 | 3;
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
    [1, 2, 3].includes(config.aircraftCount) &&
    [0, 8, 16].includes(config.spacingSec)
  );
}
export function buildAirspace(
  route: CompiledRoute,
  startAtMs: number,
  config: AirspaceConfig,
  delayScale: number,
  show?: CompiledShowFlight[],
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
    return {
      id: aircraft.id,
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

export type SoundMixMode = "focus" | "balanced";
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
    !["focus", "balanced"].includes(mode)
  )
    throw new Error("Invalid sound mix");
  const weights = ids.map((id) =>
    mode === "balanced" || id === focus ? 1 : 0.24,
  );
  const norm = Math.sqrt(weights.reduce((sum, w) => sum + w * w, 0));
  return Object.fromEntries(ids.map((id, i) => [id, weights[i] / norm]));
}
