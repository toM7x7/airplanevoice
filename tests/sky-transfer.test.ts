import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import {
  Experience,
  workshopSpec,
  DEFAULT_WORKSHOP,
  presetRoute,
} from "../packages/core/src";
import {
  applySky,
  captureSky,
  decodeSky,
  encodeSky,
  parseSky,
} from "../apps/desktop/src/sky-transfer";

describe("portable sky recipes", () => {
  for (const route of [
    presetRoute("eight"),
    workshopSpec(DEFAULT_WORKSHOP, 9),
  ]) {
    it(`round trips ${route.id}, including flight and independent start`, async () => {
      const sender = new Experience();
      sender.setRoute(route);
      const sky = captureSky(sender, 2.5, "shore");
      sky.aircraft = { bodyLengthM: 82, wingSpanM: 77, engineCount: 2 };
      sky.airspace = { aircraftCount: 3, spacingSec: 16 };
      sky.evolution = { enabled: true, amount: 0.85 };
      const code = await encodeSky(sky);
      const received = await decodeSky(code);
      expect(received).toEqual(sky);
      const receiver = new Experience();
      applySky(receiver, received);
      expect(receiver.route.checksum).toBe(sender.route.checksum);
      expect(captureSky(receiver)).toEqual(sky);
      expect(receiver.phase).toBe("EDIT");
      expect(receiver.mixMode).toBe("balanced");
      applySky(sender, sky);
      sender.start();
      receiver.start();
      expect(receiver.recipe.delayScale).toBe(2.5);
      expect(receiver.flightIds.length).toBe(3);
      expect(receiver.pose().position).toEqual(sender.pose().position);
    });
  }
  it("captures an immutable snapshot without changing the original", async () => {
    const e = new Experience(),
      sky = captureSky(e);
    const code = await encodeSky(sky);
    e.setRoute(presetRoute("rise"));
    sky.aircraft.wingSpanM = 80;
    expect((await decodeSky(code)).route.id).toBe("orbit");
    expect(e.aircraftDesign.wingSpanM).toBe(64);
  });
  it("keeps generated QR small and preserves nonstandard preview points", async () => {
    const e = new Experience();
    e.setRoute(workshopSpec(DEFAULT_WORKSHOP, 1));
    const sky = captureSky(e);
    expect((await encodeSky(sky)).length).toBeLessThan(700);
    sky.route.rawPoints[0].x += 1;
    expect((await decodeSky(await encodeSky(sky))).route.rawPoints).toEqual(
      sky.route.rawPoints,
    );
  });
  it("preserves editor points above flight altitude limits and lets the compiler constrain the flight", async () => {
    const e = new Experience();
    e.setRoute(presetRoute("rise", 0, 440));
    const sky = captureSky(e);
    expect(Math.max(...sky.route.rawPoints.map((p) => p.y))).toBeGreaterThan(
      650,
    );
    const restored = new Experience();
    applySky(restored, await decodeSky(await encodeSky(sky)));
    expect(restored.route.checksum).toBe(e.route.checksum);
  });
  it("validates the entire input before mutating a saved sky", () => {
    const e = new Experience(),
      before = captureSky(e),
      sky = captureSky(e);
    sky.route = presetRoute("rise");
    sky.aircraft.engineCount = 9 as never;
    expect(() => applySky(e, sky)).toThrow();
    expect(captureSky(e)).toEqual(before);
    expect(e.canUndo).toBe(false);
  });
  it("does not import during flight or pause", () => {
    const e = new Experience(),
      sky = captureSky(e);
    e.start();
    e.advance(e.startAtMs - e.nowMs + 1000);
    expect(() => applySky(e, sky)).toThrow(/飛行/);
    e.togglePause();
    expect(() => applySky(e, sky)).toThrow(/飛行/);
    expect(e.phase).toBe("FLY");
  });
  it("rejects versions, non-numeric coordinates, excessive points and invalid settings", () => {
    const sky = captureSky(new Experience());
    for (const change of [
      { version: 2 },
      { delayScale: 9 },
      { observer: "unknown" },
      { airspace: { aircraftCount: 4, spacingSec: 8 } },
      { evolution: { enabled: true, amount: NaN } },
      {
        route: {
          ...sky.route,
          rawPoints: [{ x: "1", y: 240, z: 0 }, ...sky.route.rawPoints],
        },
      },
      {
        route: {
          ...sky.route,
          rawPoints: Array(1001).fill(sky.route.rawPoints[0]),
        },
      },
      {
        route: {
          ...sky.route,
          rawPoints: [{ x: 0, y: 0, z: Infinity }, ...sky.route.rawPoints],
        },
      },
    ])
      expect(() => parseSky({ ...sky, ...change })).toThrow();
  });
  it("rejects malformed, oversized, compressed expansion and truncated payloads", async () => {
    const code = await encodeSky(captureSky(new Experience()));
    const bomb = `1.${gzipSync(" ".repeat(131073)).toString("base64url")}`;
    for (const invalid of [
      "",
      "2.abc",
      "1.!",
      "1." + "a".repeat(48001),
      bomb,
      code.slice(0, -12),
    ])
      await expect(decodeSky(invalid)).rejects.toThrow();
  });
});
