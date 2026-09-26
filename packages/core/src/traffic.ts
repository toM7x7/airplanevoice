import { AIRCRAFT, MAX_AIRCRAFT, type FlightId } from "./airspace";
import type { RoomState, SharedFlight } from "./shared-room";
import { trafficPlans } from "./traffic-analysis";

export const TRAFFIC_CAPACITIES = [3, 6, 9, 12, 18, 24] as const;
export interface TrafficSettings {
  capacity: number;
  jev: boolean;
  automaticIds?: string[];
  objective?: "balanced" | "lively" | "spacious";
  note?: string;
}
export interface TrafficDecision {
  at: number;
  source: "rules" | "jev";
  pace: "flow" | "spaced" | "quiet";
  note: string;
  altitude?: "near" | "spread";
}
export interface TrafficHistoryEntry {
  at: number;
  revision: number;
  source: "rules" | "jev";
  status: "selected" | "applied" | "fallback" | "discarded";
  note: string;
  gapSec?: number;
  altitudeM?: number;
  aircraft?: string;
  closePairs?: number;
  soundOverlap?: number;
}
export function recordTraffic(
  state: RoomState,
  entry: Omit<TrafficHistoryEntry, "revision">,
) {
  state.trafficHistory = [
    ...(state.trafficHistory ?? []).slice(-19),
    { ...entry, revision: state.revision },
  ];
}
export function cruiseAltitudeCandidates(
  state: RoomState,
  base: number,
  now: number,
) {
  const occupied = state.flights
    .filter((f) => f.clearAt > now)
    .flatMap((f) =>
      f.show
        ? f.show.flights.map((p) => p.recipe.route.altitudeM)
        : [f.recipe.route.altitudeM],
    );
  const dense = trafficCapacity(state) > 12;
  const eligible = Array.from(
    { length: dense ? 24 : 12 },
    (_, i) => 140 + i * (dense ? 15 : 32),
  ).filter((y) => occupied.every((h) => Math.abs(h - y) >= (dense ? 13 : 28)));
  const distance = (y: number) =>
    occupied.length ? Math.min(...occupied.map((h) => Math.abs(h - y))) : 0;
  const near =
    [...eligible].sort((a, b) => Math.abs(a - base) - Math.abs(b - base))[0] ??
    null;
  const spread =
    [...eligible].sort(
      (a, b) =>
        distance(b) - distance(a) || Math.abs(a - base) - Math.abs(b - base),
    )[0] ?? null;
  return { near, spread };
}
export const DEFAULT_TRAFFIC: TrafficSettings = { capacity: 6, jev: false };
export const trafficCapacity = (state: RoomState) =>
  state.traffic?.capacity ?? 3;
export function checkedTraffic(input: unknown): TrafficSettings {
  const v = input as TrafficSettings;
  if (
    !v ||
    !TRAFFIC_CAPACITIES.includes(v.capacity as 3) ||
    typeof v.jev !== "boolean"
  )
    throw new Error("同時飛行は3・6・9・12・18・24機から選んでください。");
  if (
    v.automaticIds !== undefined &&
    (!Array.isArray(v.automaticIds) ||
      v.automaticIds.length > 24 ||
      v.automaticIds.some(
        (id) => typeof id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(id),
      ))
  )
    throw new Error("自動便の機体を選び直してください。");
  if (
    v.objective !== undefined &&
    !["balanced", "lively", "spacious"].includes(v.objective)
  )
    throw new Error("運行方針を選び直してください。");
  if (
    v.note !== undefined &&
    (typeof v.note !== "string" || v.note.length > 160)
  )
    throw new Error("運用コメントは160文字までです。");
  return {
    capacity: v.capacity,
    jev: v.jev,
    ...(v.automaticIds !== undefined
      ? { automaticIds: [...new Set(v.automaticIds)] }
      : {}),
    ...(v.objective ? { objective: v.objective } : {}),
    ...(v.note !== undefined ? { note: v.note.trim() } : {}),
  };
}
export const flightSlots = (f: SharedFlight) => f.show?.flights.length ?? 1;

/** Stable render/audio identities survive the retirement of an older flight and late joins. */
export function withFlightSlots(flights: SharedFlight[]): SharedFlight[] {
  const until = new Map<FlightId, number>();
  return [...flights]
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((f) => {
      const ids =
        f.slotIds ??
        AIRCRAFT.filter((a) => (until.get(a.id) ?? -Infinity) <= f.startsAt)
          .slice(0, flightSlots(f))
          .map((a) => a.id);
      if (
        ids.length !== flightSlots(f) ||
        ids.length > MAX_AIRCRAFT ||
        new Set(ids).size !== ids.length ||
        ids.some(
          (id) =>
            !AIRCRAFT.some((a) => a.id === id) ||
            (until.get(id) ?? -Infinity) > f.startsAt,
        )
      )
        throw new Error("同時飛行の枠を確認してください。");
      ids.forEach((id) => until.set(id, f.clearAt));
      return { ...f, slotIds: ids };
    });
}
export function trafficFacts(state: RoomState, now: number) {
  const reserved = state.flights.filter((f) => f.clearAt > now);
  const flights = trafficPlans(state, now).map(
    ({ name, altitudeM, speedMps, startsAt, endsAt }) => ({
      name,
      altitudeM,
      speedMps,
      startsAt,
      endsAt,
    }),
  );
  return {
    at: now,
    revision: state.revision,
    capacity: trafficCapacity(state),
    occupied: reserved.reduce((n, f) => n + flightSlots(f), 0),
    airborne: flights.filter((f) => f.startsAt <= now && f.endsAt > now).length,
    waiting: flights.filter((f) => f.startsAt > now).length,
    soundTails: flights.filter((f) => f.endsAt <= now).length,
    hangarCount: state.hangar?.length ?? 0,
    flights,
  };
}
export function trafficDecision(
  state: RoomState,
  now: number,
): TrafficDecision {
  if (
    state.traffic?.jev &&
    state.trafficDecision?.source === "jev" &&
    now - state.trafficDecision.at < 90_000
  )
    return state.trafficDecision;
  const f = trafficFacts(state, now);
  const pace =
    state.traffic?.objective === "spacious"
      ? "quiet"
      : state.traffic?.objective === "lively"
        ? "flow"
        : f.occupied >= f.capacity - 1
          ? "quiet"
          : f.occupied >= Math.ceil(f.capacity / 2)
            ? "spaced"
            : "flow";
  return {
    at: now,
    source: "rules",
    pace,
    note:
      pace === "flow"
        ? "空きに合わせて順に出発"
        : pace === "spaced"
          ? "音が重なりすぎないよう出発間隔を広げます"
          : "混雑中は余韻を残して出発します",
  };
}
/** Participant flights keep 2 cruise laps; automatic flights fill 12+ aircraft skies by staying longer. */
export const automaticCruiseLaps = (capacity: number) =>
  capacity >= 24 ? 8 : capacity >= 18 ? 6 : capacity >= 12 ? 4 : 2;
export const trafficGapMs = (decision: TrafficDecision) =>
  ({ flow: 15_000, spaced: 30_000, quiet: 45_000 })[decision.pace];

/** Only upcoming automatic flights use a different altitude. Saved designs and airborne paths are immutable. */
export function availableCruiseAltitude(
  state: RoomState,
  base: number,
  now: number,
  policy: "near" | "spread" = "near",
) {
  return cruiseAltitudeCandidates(state, base, now)[policy];
}
