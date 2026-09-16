import { Experience } from "./experience";
import {
  checkedWorkshop,
  type RoomState,
  type SharedFlight,
} from "./shared-room";

/** Shared absolute time drives the existing local rendering and listener-specific arrivals. */
export class SharedPlayback {
  flightId: string | null = null;
  private previewRevision = -1;
  constructor(
    readonly experience: Experience,
    private stopAudio: () => void,
  ) {}
  tick(state: RoomState, now: number, silent = false) {
    const past = state.flights.filter((f) => f.startsAt <= now);
    const flight = past.at(-1) ?? state.flights[0];
    if (!flight) {
      if (this.flightId || this.previewRevision !== state.revision) {
        this.stopAudio();
        this.experience.edit();
        this.experience.applyWorkshop(state.draft);
        this.flightId = null;
        this.previewRevision = state.revision;
      }
      return;
    }
    const fresh = flight.id !== this.flightId;
    if (fresh) this.load(flight);
    const e = this.experience;
    e.paused = false;
    const delta = Math.max(0, now - e.nowMs);
    const callback = e.onArrival;
    if (silent || fresh || delta > 500) e.onArrival = undefined;
    try {
      e.advance(delta);
    } finally {
      e.onArrival = callback;
    }
    if (fresh || delta > 500) {
      e.trails = [];
      e.notify();
    }
  }
  private load(flight: SharedFlight) {
    const { route } = checkedWorkshop(flight.recipe);
    if (route.checksum !== flight.checksum)
      throw new Error(
        "飛行エンジンの版が一致しません。ページを更新してください。",
      );
    const e = this.experience;
    this.stopAudio();
    e.edit();
    e.applyWorkshop(flight.recipe);
    e.nowMs = flight.startsAt - 2500;
    e.start(1.6);
    this.flightId = flight.id;
  }
}
