import {
  AIRCRAFT,
  buildAirspace,
  soundMix,
  validAirspace,
  type AirspaceConfig,
  type FlightArrival,
  type FlightId,
  type FlightPlan,
  type SoundMixMode,
} from "./airspace";
import { flightPose } from "./flight";
import { distance } from "./math";
import { TowerDirector, type TowerFact, type TowerCue } from "./tower";
import { OBSERVERS, presetRoute } from "./presets";
import { selectRecipe, validRecipe } from "./recipe";
import { compileRoute } from "./route";
import type {
  CompiledRoute,
  EngineRecipe,
  FlightPose,
  RouteSpec,
  SessionPhase,
  SoundArrival,
  Vec3,
} from "./types";

export interface TrailPoint {
  flightId: FlightId;
  position: Vec3;
  arrivalAtMs: number;
  emissionId: number;
}
export interface ExperienceSnapshot {
  phase: SessionPhase;
  paused: boolean;
  lap: number;
  nowMs: number;
  elapsedMs: number;
  countdownSec: number;
  progress: number;
  arrivedCount: number;
  pendingCount: number;
  latestDelaySec: number | null;
  visibleTrailCount: number;
  checksum: string;
  durationMs: number;
  airspace: AirspaceConfig;
  fleet: {
    id: FlightId;
    accent: string;
    state: "waiting" | "flying" | "tail" | "complete";
    arrivedCount: number;
    pendingCount: number;
    pose: FlightPose;
  }[];
  mixMode: SoundMixMode;
  focusId: FlightId;
  mixGains: Partial<Record<FlightId, number>>;
  towerEnabled: boolean;
  towerCue: TowerCue | null;
}
export interface LogEntry {
  atMs: number;
  type: string;
  data: Record<string, unknown>;
}

export class Experience {
  nowMs = 0;
  phase: SessionPhase = "EDIT";
  paused = false;
  lap = 0;
  spec: RouteSpec = presetRoute("orbit");
  route: CompiledRoute = compileRoute(this.spec);
  recipe: EngineRecipe = selectRecipe(0);
  listener: Vec3 = { ...OBSERVERS[0].position };
  startAtMs = 0;
  trails: TrailPoint[] = [];
  latestArrival: SoundArrival | null = null;
  arrivedCount = 0;
  logs: LogEntry[] = [];
  airspace: AirspaceConfig = { aircraftCount: 1, spacingSec: 8 };
  mixMode: SoundMixMode = "focus";
  focusId: FlightId = "ST-01";
  flights: FlightPlan[] = [];
  tower = new TowerDirector();
  onArrival?: (arrival: FlightArrival, nowMs: number) => void;
  private listeners = new Set<() => void>();
  private history: RouteSpec[] = [];
  private notifyAt = 0;
  snapshot: ExperienceSnapshot;

  constructor() {
    this.snapshot = this.getSnapshot();
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  notify() {
    this.snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener();
  }
  log(type: string, data: Record<string, unknown> = {}) {
    this.logs.push({ atMs: this.nowMs, type, data });
    if (this.logs.length > 2000) this.logs.splice(0, this.logs.length - 2000);
  }
  get canEdit() {
    return this.phase === "EDIT";
  }
  get canUndo() {
    return this.canEdit && this.history.length > 0;
  }
  get flightIds() {
    return AIRCRAFT.slice(0, this.airspace.aircraftCount).map((a) => a.id);
  }
  get durationMs() {
    return (
      this.route.durationMs +
      (this.airspace.aircraftCount - 1) * this.airspace.spacingSec * 1000
    );
  }
  get mixGains() {
    return soundMix(this.flightIds, this.mixMode, this.focusId);
  }
  setAirspace(config: AirspaceConfig) {
    if (!this.canEdit) return;
    if (!validAirspace(config))
      throw new Error("Invalid airspace configuration");
    this.airspace = { ...config };
    if (!this.flightIds.includes(this.focusId)) this.focusId = "ST-01";
    this.log("airspace_changed", { ...config });
    this.notify();
  }
  setMix(mode: SoundMixMode, focus = this.focusId) {
    soundMix(this.flightIds, mode, focus); // Validate before changing state.
    this.mixMode = mode;
    this.focusId = focus;
    this.log("listening_changed", { mode, focus });
    this.notify();
  }
  setTower(enabled: boolean) {
    this.tower.setEnabled(enabled);
    this.log("tower_changed", { enabled, provider: "local-rules" });
    this.notify();
  }
  private fact(fact: TowerFact) {
    this.log("tower_fact", { ...fact });
    this.tower.accept(fact);
  }
  setRoute(spec: RouteSpec, remember = true) {
    if (!this.canEdit) return;
    // Compile first: errors preserve the last valid route and undo history.
    const compiled = compileRoute(spec);
    if (remember) {
      this.history.push(structuredClone(this.spec));
      if (this.history.length > 30) this.history.shift();
    }
    this.spec = structuredClone(spec);
    this.route = compiled;
    this.log("route_edit", {
      revision: spec.revision,
      points: spec.rawPoints.length,
      checksum: compiled.checksum,
      notices: compiled.notices,
    });
    this.notify();
  }
  undo() {
    if (this.canUndo) this.setRoute(this.history.pop()!, false);
  }
  start(delayScale = this.recipe.delayScale, nextLap = false) {
    if (this.phase !== "EDIT" && this.phase !== "INTERLAP") return;
    if (!validRecipe(selectRecipe(nextLap ? this.lap + 1 : 0, delayScale)))
      throw new Error("Invalid experience recipe");
    this.lap = nextLap ? this.lap + 1 : 0;
    this.recipe = selectRecipe(this.lap, delayScale);
    this.startAtMs = this.nowMs + 2500;
    this.flights = buildAirspace(
      this.route,
      this.startAtMs,
      this.airspace,
      delayScale,
    );
    this.tower.reset();
    this.fact({
      type: "scheduled",
      atMs: this.nowMs,
      count: this.airspace.aircraftCount,
      spacingSec: this.airspace.spacingSec,
    });
    this.tower.advance(this.nowMs, false);
    this.trails = [];
    this.latestArrival = null;
    this.arrivedCount = 0;
    this.phase = "COMPILE";
    this.paused = false;
    this.log("flight_scheduled", {
      startAtMs: this.startAtMs,
      checksum: this.route.checksum,
      recipe: this.recipe.id,
      durationMs: this.durationMs,
      flights: this.flights.map((f) => ({
        id: f.id,
        startAtMs: f.startAtMs,
        checksum: f.route.checksum,
      })),
    });
    this.notify();
  }
  edit() {
    this.phase = "EDIT";
    this.paused = false;
    this.flights = [];
    this.tower.reset();
    this.trails = [];
    this.latestArrival = null;
    this.arrivedCount = 0;
    this.log("return_to_edit");
    this.notify();
  }
  reset() {
    this.edit();
    this.lap = 0;
    this.history = [];
    this.recipe = selectRecipe(0);
    this.airspace = { aircraftCount: 1, spacingSec: 8 };
    this.mixMode = "focus";
    this.focusId = "ST-01";
    this.tower.setEnabled(false);
    this.listener = { ...OBSERVERS[0].position };
    this.setRoute(presetRoute("orbit"), false);
    this.log("session_reset");
    this.notify();
  }
  setListener(position: Vec3) {
    this.listener = { ...position };
    this.log("observer_changed", { position });
    this.notify();
  }
  togglePause() {
    if (!["COMPILE", "FLY", "ARRIVAL"].includes(this.phase)) return;
    this.paused = !this.paused;
    this.log(this.paused ? "paused" : "resumed");
    this.notify();
  }
  advance(ms: number) {
    if (!Number.isFinite(ms) || ms < 0)
      throw new Error("Time step must be finite and nonnegative");
    if (this.paused) return;
    this.nowMs += ms;
    if (this.phase === "COMPILE" && this.nowMs >= this.startAtMs) {
      this.phase = "FLY";
      this.log("flight_started");
    }
    if (this.phase === "FLY" || this.phase === "ARRIVAL") {
      const arrivals: FlightArrival[] = [];
      for (const f of this.flights) {
        if (!f.started && this.nowMs >= f.startAtMs) {
          f.started = true;
          this.fact({ type: "started", atMs: f.startAtMs, flightId: f.id });
        }
        const arrived = f.queue.advance(this.nowMs, this.listener);
        if (!f.arrivedCount && arrived.length)
          this.fact({
            type: "first-arrival",
            atMs: arrived[0].arrivalAtMs,
            flightId: f.id,
          });
        f.arrivedCount += arrived.length;
        arrivals.push(...arrived.map((a) => ({ ...a, flightId: f.id })));
        if (!f.ended && this.nowMs >= f.startAtMs + f.route.durationMs) {
          f.ended = true;
          this.fact({
            type: "ended",
            atMs: f.startAtMs + f.route.durationMs,
            flightId: f.id,
          });
        }
      }
      arrivals.sort(
        (a, b) =>
          a.arrivalAtMs - b.arrivalAtMs || a.flightId.localeCompare(b.flightId),
      );
      for (const arrival of arrivals) {
        this.arrivedCount++;
        this.latestArrival = arrival;
        this.trails.push({
          flightId: arrival.flightId,
          position: arrival.emission.position,
          arrivalAtMs: arrival.arrivalAtMs,
          emissionId: arrival.emission.id,
        });
        this.onArrival?.(arrival, this.nowMs);
      }
      if (arrivals.length)
        this.log("audio_arrival", {
          count: arrivals.length,
          latestArrivalAtMs: this.latestArrival!.arrivalAtMs,
          dispatchAtMs: this.nowMs,
        });
      if (
        this.nowMs >= this.startAtMs + this.durationMs &&
        this.phase === "FLY"
      ) {
        this.phase = "ARRIVAL";
        this.log("lap_completed");
      }
      if (
        this.phase === "ARRIVAL" &&
        this.flights.every((f) => f.queue.remaining === 0)
      ) {
        this.phase = "INTERLAP";
        this.log("arrival_completed");
        this.fact({
          type: "clear",
          atMs: this.latestArrival?.arrivalAtMs ?? this.nowMs,
        });
      }
    }
    this.trails = this.trails
      .filter(
        (t) =>
          this.nowMs - t.arrivalAtMs < this.recipe.trailPersistenceSec * 1000,
      )
      .slice(-128 * this.airspace.aircraftCount);
    const focused = this.flights.find((f) => f.id === this.focusId);
    const nearPass =
      !!focused &&
      focused.started &&
      !focused.ended &&
      distance(this.pose(focused.id).position, this.listener) < 650;
    this.tower.advance(this.nowMs, nearPass);
    if (this.nowMs - this.notifyAt >= 100) {
      this.notifyAt = this.nowMs;
      this.notify();
    }
  }
  pose(id: FlightId = "ST-01"): FlightPose {
    const flight = this.flights.find((f) => f.id === id);
    return flightPose(
      flight?.route ?? this.route,
      this.phase === "EDIT"
        ? this.route.durationMs * 0.22
        : Math.max(0, this.nowMs - (flight?.startAtMs ?? this.startAtMs)),
    );
  }
  getSnapshot(): ExperienceSnapshot {
    const elapsedMs =
      this.phase === "EDIT" ? 0 : Math.max(0, this.nowMs - this.startAtMs);
    return {
      phase: this.phase,
      paused: this.paused,
      lap: this.lap,
      nowMs: this.nowMs,
      elapsedMs,
      countdownSec:
        this.phase === "COMPILE"
          ? Math.max(0, this.startAtMs - this.nowMs) / 1000
          : 0,
      progress: Math.min(1, elapsedMs / this.durationMs),
      arrivedCount: this.arrivedCount,
      pendingCount: this.flights.reduce((sum, f) => sum + f.queue.remaining, 0),
      latestDelaySec: this.latestArrival
        ? (this.latestArrival.arrivalAtMs -
            this.latestArrival.emission.emitAtMs) /
          1000
        : null,
      visibleTrailCount: this.trails.length,
      checksum: this.route.checksum,
      durationMs: this.durationMs,
      airspace: { ...this.airspace },
      fleet: this.flights.map((f) => ({
        id: f.id,
        accent: f.accent,
        state: !f.started
          ? "waiting"
          : !f.ended
            ? "flying"
            : f.queue.remaining
              ? "tail"
              : "complete",
        arrivedCount: f.arrivedCount,
        pendingCount: f.queue.remaining,
        pose: this.pose(f.id),
      })),
      mixMode: this.mixMode,
      focusId: this.focusId,
      mixGains: this.mixGains,
      towerEnabled: this.tower.enabled,
      towerCue: this.tower.cue,
    };
  }
}
