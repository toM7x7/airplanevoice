export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface RouteSpec {
  id: string;
  revision: number;
  rawPoints: Vec3[];
  closed: true;
}
export interface AircraftProfile {
  id: "heavy_four_engine";
  speedMps: number;
  maxBankRad: number;
  maxClimbGradient: number;
  minAltitudeM: number;
  maxAltitudeM: number;
}
export interface RouteSample {
  sM: number;
  position: Vec3;
  tangent: Vec3;
  curvature: number;
}
export interface CompiledRoute {
  routeId: string;
  revision: number;
  samples: RouteSample[];
  totalLengthM: number;
  durationMs: number;
  checksum: string;
  notices: string[];
  speedMps: number;
  maxBankRad: number;
}
export type SessionPhase = "EDIT" | "COMPILE" | "FLY" | "ARRIVAL" | "INTERLAP";
export interface EngineRecipe {
  schemaVersion: "1.0";
  id: string;
  delayScale: number;
  trailPersistenceSec: number;
  trailOpacity: number;
  lowFrequencyGain: number;
}
export interface SoundEmission {
  id: number;
  emitAtMs: number;
  position: Vec3;
  velocity: Vec3;
}
export interface SoundArrival {
  emission: SoundEmission;
  arrivalAtMs: number;
  distanceM: number;
  pitchRatio: number;
}
export interface FlightPose {
  position: Vec3;
  tangent: Vec3;
  bankRad: number;
  phase01: number;
}
