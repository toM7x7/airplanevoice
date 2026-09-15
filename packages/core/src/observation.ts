import type { Experience } from "./experience";
import { type FlightId } from "./airspace";
import { distance, mod } from "./math";
import type { Vec3 } from "./types";

const DIRECTIONS = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];

// World north is -Z; the compass increases clockwise towards +X (east).
export function compassHeading(tangent: Vec3) {
  const degrees = mod((Math.atan2(tangent.x, -tangent.z) * 180) / Math.PI, 360);
  return { degrees, label: DIRECTIONS[Math.round(degrees / 45) % 8] };
}

export function aircraftInfo(e: Experience, id: FlightId) {
  if (!e.flightIds.includes(id)) return null;
  const flight = e.flights.find((f) => f.id === id);
  const state = e.canEdit
    ? "preview"
    : !flight?.started
      ? "waiting"
      : !flight.ended
        ? "flying"
        : flight.queue.remaining
          ? "tail"
          : "complete";
  const visible =
    state === "flying" || (state === "preview" && (id === "ST-01" || !!e.show));
  // Finished flights are invisible. Do not report their wrapped pose as a new lap.
  const pose = visible ? e.pose(id) : null;
  const heading = pose ? compassHeading(pose.tangent) : null;
  return {
    id,
    state,
    paused: e.paused,
    visible,
    speedMps: pose ? e.routeFor(id).speedMps : null,
    headingDeg: heading?.degrees ?? null,
    headingLabel: heading?.label ?? null,
    altitudeM: pose?.position.y ?? null,
    distanceM: pose ? distance(pose.position, e.listener) : null,
  };
}

export type AircraftInfo = NonNullable<ReturnType<typeof aircraftInfo>>;
