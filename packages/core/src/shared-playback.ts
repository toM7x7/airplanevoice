import { compileShow } from "./show";
import { Experience } from "./experience";
import { MAX_AIRCRAFT } from "./airspace";
import { withFlightSlots } from "./traffic";
import {
  sharedFlightRoute,
  type RoomState,
  type SharedFlight,
} from "./shared-room";

/** Shared timestamps drive every aircraft and its independently delayed sound. */
export class SharedPlayback {
  flightId: string | null = null;
  private key = "";
  private previewRevision = -1;
  names: {
    id: string;
    name: string;
    sourceEntryId?: string;
    startsAt: number;
    endsAt: number;
  }[] = [];
  constructor(
    readonly experience: Experience,
    private stopAudio: () => void,
  ) {}
  tick(state: RoomState, now: number, silent = false) {
    const flights = withFlightSlots(state.flights);
    const current = flights.filter((f) => f.startsAt <= now && f.clearAt > now);
    const pending = flights.find((f) => f.startsAt > now);
    const slots = current.reduce(
      (n, f) => n + (f.show?.flights.length ?? 1),
      0,
    );
    const group = [...current];
    if (
      pending &&
      slots + (pending.show?.flights.length ?? 1) <= MAX_AIRCRAFT &&
      pending.slotIds!.every(
        (id) => !current.some((f) => f.slotIds!.includes(id)),
      )
    )
      group.push(pending);
    if (!group.length && state.flights.length) group.push(flights.at(-1)!);
    if (!group.length) {
      if (this.flightId || this.previewRevision !== state.revision) {
        this.stopAudio();
        this.experience.edit();
        this.experience.applyWorkshop(state.draft);
        this.flightId = null;
        this.key = "";
        this.names = [];
        this.previewRevision = state.revision;
      }
      return;
    }
    this.flightId = current.at(-1)?.id ?? group[0].id;
    const key = group.map((f) => f.id + f.checksum).join("|");
    const fresh = key !== this.key;
    if (fresh) {
      this.load(group, now);
      this.key = key;
    }
    const e = this.experience;
    e.paused = false;
    const delta = Math.max(0, now - e.nowMs),
      callback = e.onArrival;
    if (silent || fresh || delta > 500) e.onArrival = undefined;
    try {
      e.advance(delta);
    } finally {
      e.onArrival = callback;
    }
    if (delta > 500) e.trails = [];
    if (fresh || delta > 500) e.notify();
  }
  private load(group: SharedFlight[], now: number) {
    const base = Math.min(...group.map((f) => f.startsAt));
    const entries = group.flatMap((f) => {
      if (f.show) {
        const show = compileShow(f.show);
        if (show.checksum !== f.checksum)
          throw new Error(
            "飛行エンジンの版が一致しません。ページを更新してください。",
          );
        return show.flights.map((p, i) => ({
          ...p,
          id: f.slotIds![i],
          startSec: p.startSec + (f.startsAt - base) / 1000,
          name: f.names?.[i] ?? `機体 ${i + 1}`,
          sourceEntryId: f.entryIds?.[i],
        }));
      }
      const route = sharedFlightRoute(f);
      if (route.checksum !== f.checksum)
        throw new Error(
          "飛行エンジンの版が一致しません。ページを更新してください。",
        );
      return [
        {
          id: f.slotIds![0],
          recipe: f.recipe,
          route,
          startSec: (f.startsAt - base) / 1000,
          name: f.names?.[0] ?? "旅客機",
          sourceEntryId: f.entryIds?.[0],
        },
      ];
    });
    if (entries.length > MAX_AIRCRAFT)
      throw new Error("同時飛行の予定を確認してください。");
    const e = this.experience,
      previous = e.flights,
      trails = e.trails;
    const continuing = previous.some((old) =>
      entries.some(
        (p) =>
          old.id === p.id &&
          old.startAtMs === base + p.startSec * 1000 &&
          (old.route.checksum === p.route.checksum || p.route.checksum.includes("/instructions-")),
      ),
    );
    if (!continuing) this.stopAudio();
    e.edit();
    e.applyWorkshop(entries[0].recipe);
    // Compiled routes retain takeoff and repeated laps; no re-compilation through a UI recipe.
    e.compiledShow = {
      recipe: {
        version: 1,
        title: "みんなの空",
        flights: entries.map(({ recipe, startSec }) => ({ recipe, startSec })),
      },
      flights: entries,
      durationMs: Math.max(
        ...entries.map((p) => p.startSec * 1000 + p.route.durationMs),
      ),
      checksum: group.map((f) => f.checksum).join("|"),
    };
    e.route = entries[0].route;
    e.airspace = { aircraftCount: entries.length, spacingSec: 0 };
    if (!e.flightIds.includes(e.focusId)) e.focusId = entries[0].id;
    e.nowMs = base - 2500;
    e.start(1.6);
    e.flights = e.flights.map((f) => {
      const old = previous.find(
        (p) =>
          p.id === f.id &&
          p.startAtMs === f.startAtMs &&
          (p.route.checksum === f.route.checksum || f.route.checksum.includes("/instructions-")),
      );
      if (old) {
        if(old.route.checksum!==f.route.checksum) {
          old.queue.replaceFuture(f.queue.emissions, now);
          old.route=f.route;
        }
        return old;
      }
      // Joining a running room must not replay its historical audio.
      f.queue.advance(Math.min(now, Math.max(base, now - 1)), e.listener);
      return f;
    });
    e.nowMs = Math.min(now, base);
    if (continuing)
      e.trails = trails.filter((t) =>
        previous.some((p) => p.id === t.flightId && e.flights.includes(p)),
      );
    this.names = entries.map((p) => ({
      id: p.id,
      name: p.name,
      sourceEntryId: p.sourceEntryId,
      startsAt: base + p.startSec * 1000,
      endsAt: base + p.startSec * 1000 + p.route.durationMs,
    }));
  }
}
