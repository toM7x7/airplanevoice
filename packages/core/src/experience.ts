import { ArrivalQueue, createEmissions } from "./acoustics";
import { flightPose } from "./flight";
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
  onArrival?: (arrival: SoundArrival, nowMs: number) => void;
  private queue: ArrivalQueue | null = null;
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
    this.queue = new ArrivalQueue(
      createEmissions(this.route, this.startAtMs),
      delayScale,
    );
    this.trails = [];
    this.latestArrival = null;
    this.arrivedCount = 0;
    this.phase = "COMPILE";
    this.paused = false;
    this.log("flight_scheduled", {
      startAtMs: this.startAtMs,
      checksum: this.route.checksum,
      recipe: this.recipe.id,
      durationMs: this.route.durationMs,
    });
    this.notify();
  }
  edit() {
    this.phase = "EDIT";
    this.paused = false;
    this.queue = null;
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
      const arrivals = this.queue?.advance(this.nowMs, this.listener) ?? [];
      for (const arrival of arrivals) {
        this.arrivedCount++;
        this.latestArrival = arrival;
        this.trails.push({
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
        this.nowMs >= this.startAtMs + this.route.durationMs &&
        this.phase === "FLY"
      ) {
        this.phase = "ARRIVAL";
        this.log("lap_completed");
      }
      if (this.phase === "ARRIVAL" && this.queue?.remaining === 0) {
        this.phase = "INTERLAP";
        this.log("arrival_completed");
      }
    }
    this.trails = this.trails
      .filter(
        (t) =>
          this.nowMs - t.arrivalAtMs < this.recipe.trailPersistenceSec * 1000,
      )
      .slice(-128);
    if (this.nowMs - this.notifyAt >= 100) {
      this.notifyAt = this.nowMs;
      this.notify();
    }
  }
  pose(): FlightPose {
    return flightPose(
      this.route,
      this.phase === "EDIT"
        ? this.route.durationMs * 0.22
        : Math.max(0, this.nowMs - this.startAtMs),
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
      progress: Math.min(1, elapsedMs / this.route.durationMs),
      arrivedCount: this.arrivedCount,
      pendingCount: this.queue?.remaining ?? 0,
      latestDelaySec: this.latestArrival
        ? (this.latestArrival.arrivalAtMs -
            this.latestArrival.emission.emitAtMs) /
          1000
        : null,
      visibleTrailCount: this.trails.length,
      checksum: this.route.checksum,
      durationMs: this.route.durationMs,
    };
  }
}
