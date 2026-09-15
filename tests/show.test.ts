import { describe, it, expect } from "vitest";
import {
  Experience,
  compileShow,
  showPattern,
  flightPose,
  aircraftInfo,
  closestPass,
  OBSERVERS,
  ROUTE_PATTERNS,
  AIRCRAFT_PATTERNS,
  compileRoute,
  workshopSpec,
} from "../packages/core/src";
import {
  captureSky,
  encodeSky,
  decodeSky,
  applySky,
} from "../apps/desktop/src/sky-transfer";

describe("authored air shows", () => {
  it.each([0, 1, 2])(
    "compiles pattern %s deterministically and keeps independent plans",
    (i) => {
      const show = showPattern(i),
        compiled = compileShow(show),
        e = new Experience();
      expect(compileShow(show)).toEqual(compiled);
      e.applyShow(show);
      expect(e.flightIds.length).toBe(show.flights.length);
      expect(e.durationMs).toBe(compiled.durationMs);
      e.flightIds.forEach((id, n) => {
        expect(e.designFor(id)).toEqual(show.flights[n].recipe.aircraft);
        expect(aircraftInfo(e, id)?.visible).toBe(true);
        expect(aircraftInfo(e, id)?.speedMps).toBe(
          show.flights[n].recipe.flight.speedMps,
        );
      });
      e.start();
      e.flights.forEach((f, n) => {
        expect(f.startAtMs).toBe(e.startAtMs + show.flights[n].startSec * 1000);
        expect(f.route).toEqual(compiled.flights[n].route);
      });
    },
  );
  it("validates all aircraft before committing and locks edits throughout flight and pause", () => {
    const e = new Experience();
    e.applyShow(showPattern());
    const before = e.getSnapshot(),
      bad = showPattern();
    bad.flights[1].recipe.route.b = { ...bad.flights[1].recipe.route.a };
    expect(() => e.applyShow(bad)).toThrow();
    expect(e.getSnapshot()).toEqual(before);
    for (const startSec of [-1, NaN, 181]) {
      const bad = showPattern();
      bad.flights[1].startSec = startSec;
      expect(() => e.applyShow(bad)).toThrow();
      expect(e.getSnapshot()).toEqual(before);
    }
    e.start();
    const checksum = e.snapshot.checksum;
    e.applyShow(showPattern(2));
    e.togglePause();
    e.applyShow(showPattern(1));
    e.clearShow();
    expect(e.snapshot.checksum).toBe(checksum);
    expect(e.flightIds.length).toBe(2);
  });
  it("honours a late second start, waits for all flights and sounds, and replays identical plans", () => {
    const e = new Experience(),
      s = showPattern();
    s.flights[1].startSec = 120;
    e.applyShow(s);
    const received = new Set<string>();
    e.onArrival = (a) => received.add(a.flightId);
    e.start();
    e.advance(3000);
    expect(e.flights[0].started).toBe(true);
    expect(e.flights[1].started).toBe(false);
    expect(aircraftInfo(e, "ST-02")?.speedMps).toBeNull();
    e.advance(120000);
    expect(e.flights[1].started).toBe(true);
    expect(e.phase).toBe("FLY");
    const f = e.flights[1];
    expect(e.pose(f.id)).toEqual(flightPose(f.route, e.nowMs - f.startAtMs));
    for (let i = 0; i < 8000 && e.phase !== "INTERLAP"; i++) e.advance(50);
    expect(e.phase).toBe("INTERLAP");
    expect(received).toEqual(new Set(["ST-01", "ST-02"]));
    expect(e.flights.every((f) => f.ended && f.queue.remaining === 0)).toBe(
      true,
    );
    const first = e.flights.map((f) => f.route.checksum),
      sound = e.recipe;
    e.start(e.recipe.delayScale, true);
    expect(e.flights.map((f) => f.route.checksum)).toEqual(first);
    expect(e.recipe).toEqual(sound);
    e.edit();
    expect(e.show).toEqual(s);
    expect(e.flights.length).toBe(0);
    e.clearShow();
    expect(e.show).toBeNull();
    expect(e.flightIds).toEqual(["ST-01"]);
  });
  it("does not falsely announce simultaneous launch for independently scheduled aircraft", () => {
    const e = new Experience();
    e.applyShow(showPattern());
    e.setTower(true);
    e.start();
    expect(e.snapshot.towerCue?.text).toContain("演目の順");
    expect(() => e.setEvolution({ enabled: true, amount: 0.5 })).toThrow();
    e.reset();
    expect(e.show).toBeNull();
    expect(e.spec.id).toBe("orbit");
  });
  it("keeps every workshop pattern in the supported flight envelope", () => {
    for (const p of ROUTE_PATTERNS)
      for (const a of AIRCRAFT_PATTERNS) {
        const route = compileRoute(
          workshopSpec(
            {
              version: 1,
              aircraft: a.aircraft,
              route: p.route,
              flight: p.flight,
            },
            1,
          ),
        );
        expect(route.durationMs).toBeLessThan(300000);
        expect(route.notices.some((n) => n.includes("置き換え"))).toBe(false);
      }
  });
  it("predicts closest-pass sound from the observation point and start offset", () => {
    const route = compileShow(showPattern()).flights[0].route;
    const p = closestPass(route, OBSERVERS[0].position, 16, 2);
    const initial = closestPass(route, OBSERVERS[0].position, 0, 1);
    expect(p.passSec - initial.passSec).toBeCloseTo(16);
    expect(p.soundSec - p.passSec).toBeCloseTo((2 * p.distanceM) / 343);
    expect(closestPass(route, OBSERVERS[1].position)).not.toEqual(initial);
  });
  it("round trips all show aircraft through a versioned QR without auto-starting", async () => {
    const sender = new Experience();
    sender.applyShow(showPattern(2));
    const sky = captureSky(sender, 2, "hill"),
      code = await encodeSky(sky);
    expect(code.startsWith("2.")).toBe(true);
    expect(code.length).toBeLessThan(1800);
    const received = await decodeSky(code),
      receiver = new Experience();
    applySky(receiver, received);
    expect(receiver.show).toEqual(sender.show);
    expect(receiver.snapshot.checksum).toBe(sender.snapshot.checksum);
    expect(receiver.phase).toBe("EDIT");
    expect(receiver.mixMode).toBe("balanced");
    expect(captureSky(receiver)).toEqual(sky);
    await expect(decodeSky("1." + code.slice(2))).rejects.toThrow();
    const bad = structuredClone(sky);
    bad.show!.flights[1].recipe.flight.speedMps = 900;
    expect(() => applySky(receiver, bad)).toThrow();
    expect(receiver.show).toEqual(sender.show);
  });
});
