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
import type { SoundTraceMode } from "./sound-presence";
import { compileShow, type ShowRecipe } from "./show";
import { distance } from "./math";
import { TowerDirector, type TowerFact, type TowerCue } from "./tower";
import {
  DEFAULT_AIRCRAFT,
  validateAircraft,
  workshopSpec,
  type AircraftDesign,
  type WorkshopRecipe,
} from "./workshop";
import { OBSERVERS, presetRoute } from "./presets";
import { selectRecipe, validRecipe } from "./recipe";
import { compileRoute } from "./route";
import {
  evolveRoute,
  EVOLUTION_REST_MS,
  type EvolutionSettings,
} from "./evolution";
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
  aircraftDesign: AircraftDesign;
  show: ShowRecipe | null;
  evolution: EvolutionSettings & {
    nextInSec: number | null;
    error: string | null;
    changed: boolean;
    baseChecksum: string | null;
  };
}
export interface LogEntry {
  atMs: number;
  type: string;
  data: Record<string, unknown>;
}

export class Experience {
  soundTraceMode: SoundTraceMode = "soft";
  setSoundTrace(mode: SoundTraceMode) { this.soundTraceMode = mode; this.notify(); }
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
  aircraftDesign: AircraftDesign = { ...DEFAULT_AIRCRAFT };
  compiledShow: ReturnType<typeof compileShow> | null = null;
  /** Plans the next start() may keep unchanged (shared sky reloads). */
  reusablePlans: FlightPlan[] = [];
  get show() {
    return this.compiledShow?.recipe ?? null;
  }
  applyShow(input: unknown) {
    if (!this.canEdit) return;
    const compiled = compileShow(input);
    this.compiledShow = compiled;
    this.spec = workshopSpec(compiled.recipe.flights[0].recipe, 1);
    this.route = compiled.flights[0].route;
    this.aircraftDesign = { ...compiled.recipe.flights[0].recipe.aircraft };
    this.airspace = {
      aircraftCount: compiled.flights.length,
      spacingSec: 0,
    };
    this.history = [];
    this.evolution = { ...this.evolution, enabled: false };
    this.mixMode = "balanced";
    if (!this.flightIds.includes(this.focusId)) this.focusId = "ST-01";
    this.log("show_applied", {
      title: compiled.recipe.title,
      checksum: compiled.checksum,
    });
    this.notify();
  }
  clearShow() {
    if (!this.canEdit || !this.compiledShow) return;
    this.compiledShow = null;
    this.airspace = { aircraftCount: 1, spacingSec: 8 };
    this.focusId = "ST-01";
    this.notify();
  }
  designFor(id: FlightId) {
    return (
      this.compiledShow?.flights.find((f) => f.id === id)?.recipe.aircraft ??
      this.aircraftDesign
    );
  }
  routeFor(id: FlightId) {
    return (
      this.flights.find((f) => f.id === id)?.route ??
      this.compiledShow?.flights.find((f) => f.id === id)?.route ??
      this.route
    );
  }
  evolution: EvolutionSettings = { enabled: false, amount: 0.65 };
  private evolutionBase: { spec: RouteSpec; route: CompiledRoute } | null =
    null;
  private nextLapAtMs: number | null = null;
  private evolutionError: string | null = null;
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
  setEvolution(settings: EvolutionSettings) {
    if (this.show && settings.enabled)
      throw new Error(
        "演目は同じ予定で試演します。変化する周回は単体の航路で使えます。",
      );
    if (
      typeof settings.enabled !== "boolean" ||
      !Number.isFinite(settings.amount) ||
      settings.amount < 0 ||
      settings.amount > 1
    )
      throw new Error("変化の設定を確認してください。");
    this.evolution = { ...settings };
    this.evolutionError = null;
    if (!settings.enabled) this.nextLapAtMs = null;
    else if (this.phase === "INTERLAP" && this.nextLapAtMs === null)
      this.nextLapAtMs = this.nowMs + EVOLUTION_REST_MS;
    this.log("evolution_changed", { ...settings });
    this.notify();
  }
  setAircraftDesign(design: AircraftDesign) {
    if (!this.canEdit) return;
    validateAircraft(design);
    this.compiledShow = null;
    this.keepFocus();
    this.aircraftDesign = { ...design };
    this.log("aircraft_design", { ...design });
    this.notify();
  }
  applyWorkshop(recipe: WorkshopRecipe) {
    if (!this.canEdit) return;
    const spec = workshopSpec(recipe, this.spec.revision + 1);
    // Validate the complete proposal before committing either aircraft or route.
    compileRoute(spec);
    this.setRoute(spec);
    this.setAircraftDesign(recipe.aircraft);
    this.log("workshop_applied", {
      version: recipe.version,
      seed: recipe.route.seed,
    });
  }
  get flightIds() {
    return this.compiledShow?.flights.map((f) => f.id) ?? AIRCRAFT.slice(0, this.airspace.aircraftCount).map((a) => a.id);
  }
  get durationMs() {
    if (this.compiledShow) return this.compiledShow.durationMs;
    return (
      this.route.durationMs +
      (this.airspace.aircraftCount - 1) * this.airspace.spacingSec * 1000
    );
  }
  get mixGains() {
    const ids = this.flightIds;
    return soundMix(ids, this.mixMode, ids.includes(this.focusId) ? this.focusId : ids[0]);
  }
  /** Leaving a shared or composed sky can drop the focused slot (e.g. ST-02 of one remaining flight). */
  private keepFocus() {
    if (!this.flightIds.includes(this.focusId)) this.focusId = this.flightIds[0];
  }
  setAirspace(config: AirspaceConfig) {
    if (!this.canEdit) return;
    if (this.show) return;
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
    this.compiledShow = null;
    this.keepFocus();
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
    if (!nextLap) {
      this.evolutionBase = {
        spec: structuredClone(this.spec),
        route: this.route,
      };
      this.evolutionError = null;
    } else if (this.evolution.enabled && this.evolutionBase) {
      try {
        const spec = evolveRoute(
          this.evolutionBase.spec,
          this.lap + 1,
          this.evolution.amount,
        );
        const route = compileRoute(spec);
        if (
          route.notices.some((n) => n.includes("置き換え")) ||
          route.samples.some(
            (p) =>
              Math.abs(p.position.x) > 6000 || Math.abs(p.position.z) > 6000,
          )
        )
          throw new Error("次の航路が観察空域に収まりませんでした。");
        this.spec = spec;
        this.route = route;
        this.log("route_evolved", {
          lap: this.lap + 1,
          checksum: route.checksum,
          baseChecksum: this.evolutionBase.route.checksum,
          amount: this.evolution.amount,
        });
      } catch (err) {
        this.evolutionError = err instanceof Error ? err.message : String(err);
        this.evolution = { ...this.evolution, enabled: false };
        this.nextLapAtMs = null;
        this.log("evolution_stopped", { reason: this.evolutionError });
        this.notify();
        return;
      }
    }
    this.nextLapAtMs = null;
    this.lap = nextLap ? this.lap + 1 : 0;
    this.recipe = selectRecipe(this.show ? 0 : this.lap, delayScale);
    this.startAtMs = this.nowMs + 2500;
    this.flights = buildAirspace(
      this.route,
      this.startAtMs,
      this.airspace,
      delayScale,
      this.compiledShow?.flights,
      this.reusablePlans,
    );
    this.reusablePlans = [];
    this.tower.reset();
    this.fact({
      type: "scheduled",
      atMs: this.nowMs,
      count: this.airspace.aircraftCount,
      spacingSec: this.airspace.spacingSec,
      customSchedule: !!this.show,
    });
    this.tower.advance(this.nowMs, false);
    this.trails = [];
    this.latestArrival = null;
    this.arrivedCount = 0;
    this.phase = "COMPILE";
    this.paused = false;
    this.log("flight_scheduled", {
      startAtMs: this.startAtMs,
      checksum: this.compiledShow?.checksum ?? this.route.checksum,
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
  edit(keepCurrentRoute = false) {
    if (this.evolutionBase && !keepCurrentRoute) {
      this.spec = structuredClone(this.evolutionBase.spec);
      this.route = this.evolutionBase.route;
    }
    if (keepCurrentRoute && this.evolutionBase) {
      this.history.push(structuredClone(this.evolutionBase.spec));
      if (this.history.length > 30) this.history.shift();
      this.log("evolution_kept", { checksum: this.route.checksum });
    }
    this.evolutionBase = null;
    this.nextLapAtMs = null;
    this.evolutionError = null;
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
    this.compiledShow = null;
    this.lap = 0;
    this.history = [];
    this.evolution = { enabled: false, amount: 0.65 };
    this.recipe = selectRecipe(0);
    this.airspace = { aircraftCount: 1, spacingSec: 8 };
    this.mixMode = "focus";
    this.focusId = "ST-01";
    this.tower.setEnabled(false);
    this.aircraftDesign = { ...DEFAULT_AIRCRAFT };
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
  // Tracking does not create a log or React notification for every XR frame.
  trackListener(position: Vec3) {
    if (![position.x, position.y, position.z].every(Number.isFinite)) return;
    this.listener.x = position.x;
    this.listener.y = position.y;
    this.listener.z = position.z;
  }
  togglePause() {
    if (this.phase === "EDIT") return;
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
        if (this.evolution.enabled)
          this.nextLapAtMs = this.nowMs + EVOLUTION_REST_MS;
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
    if (
      this.phase === "INTERLAP" &&
      this.evolution.enabled &&
      this.nextLapAtMs !== null &&
      this.nowMs >= this.nextLapAtMs
    )
      this.start(this.recipe.delayScale, true);
    if (this.nowMs - this.notifyAt >= 100) {
      this.notifyAt = this.nowMs;
      this.notify();
    }
  }
  pose(id: FlightId = "ST-01"): FlightPose {
    const flight = this.flights.find((f) => f.id === id);
    return flightPose(
      this.routeFor(id),
      this.phase === "EDIT"
        ? this.routeFor(id).durationMs * 0.22
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
      checksum: this.compiledShow?.checksum ?? this.route.checksum,
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
      aircraftDesign: { ...this.aircraftDesign },
      show: this.show,
      evolution: {
        ...this.evolution,
        nextInSec:
          this.nextLapAtMs === null
            ? null
            : Math.max(0, this.nextLapAtMs - this.nowMs) / 1000,
        error: this.evolutionError,
        changed:
          !!this.evolutionBase &&
          this.route.checksum !== this.evolutionBase.route.checksum,
        baseChecksum: this.evolutionBase?.route.checksum ?? null,
      },
    };
  }
}
