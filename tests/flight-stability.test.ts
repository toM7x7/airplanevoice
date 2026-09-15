import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import {
  compileRoute,
  DEFAULT_WORKSHOP,
  flightPose,
  presetRoute,
  workshopSpec,
  type CompiledRoute,
} from "../packages/core/src";

const degrees = 180 / Math.PI;
const circleRecipe = structuredClone(DEFAULT_WORKSHOP);
circleRecipe.route.widthM = 1100;
circleRecipe.route.variation = 0;
circleRecipe.flight.bankResponseSec = 0;

function measure(route: CompiledRoute) {
  const count = Math.ceil(route.durationMs / 20);
  const dt = route.durationMs / count;
  const banks = Array.from(
    { length: count },
    (_, i) => flightPose(route, i * dt).bankRad * degrees,
  );
  const rates = banks.map(
    (bank, i) => (banks[(i + 1) % count] - bank) / (dt / 1000),
  );
  return {
    minBankDeg: Math.min(...banks),
    maxBankDeg: Math.max(...banks),
    maxRollRateDegSec: Math.max(...rates.map(Math.abs)),
    // Removes the broad turn: departure from a centered 1-second trend.
    maxQuickWobbleDeg: Math.max(
      ...banks.map((bank, i) =>
        Math.abs(
          bank -
            (banks[(i + count - 25) % count] + banks[(i + 25) % count]) / 2,
        ),
      ),
    ),
  };
}

describe("stable flight attitude", () => {
  it.each([0, 1.2, 3])(
    "holds a steady circular bank with response %s seconds",
    (response) => {
      const recipe = structuredClone(circleRecipe);
      recipe.flight.bankResponseSec = response;
      const route = compileRoute(workshopSpec(recipe, 1));
      const expected = Math.atan(route.speedMps ** 2 / (9.81 * 1100)) * degrees;
      const measured = measure(route);
      expect(Math.abs(Math.abs(measured.minBankDeg) - expected)).toBeLessThan(
        0.01,
      );
      expect(Math.abs(Math.abs(measured.maxBankDeg) - expected)).toBeLessThan(
        0.01,
      );
      expect(measured.maxRollRateDegSec).toBeLessThan(0.01);
    },
  );

  it("follows the changing curvature of an ellipse without artificial flutter", () => {
    const recipe = structuredClone(circleRecipe);
    recipe.route.widthM = 900;
    const route = compileRoute(workshopSpec(recipe, 1));
    // Analytic ellipse: x = -a cos(t), z = center + b sin(t).
    for (let i = 0; i < 1000; i++) {
      const pose = flightPose(route, (i / 1000) * route.durationMs);
      const t = Math.atan2(
        (pose.position.z + 1400) / 900,
        -pose.position.x / 1100,
      );
      const k =
        (1100 * 900) /
        (1100 ** 2 * Math.sin(t) ** 2 + 900 ** 2 * Math.cos(t) ** 2) ** 1.5;
      const expected = Math.atan((route.speedMps ** 2 * k) / 9.81);
      expect(Math.abs(pose.bankRad - expected) * degrees).toBeLessThan(0.02);
    }
  });

  it("also keeps a hand-authored circular spline steady in either direction", () => {
    const points = Array.from({ length: 24 }, (_, i) => ({
      x: 1100 * Math.sin((i / 24) * Math.PI * 2),
      y: 240,
      z: -1400 + 1100 * Math.cos((i / 24) * Math.PI * 2),
    }));
    for (const rawPoints of [points, [...points].reverse()]) {
      const route = compileRoute({
        id: "drawn-circle",
        revision: 1,
        closed: true,
        rawPoints,
      });
      const measured = measure(route);
      expect(measured.maxBankDeg - measured.minBankDeg).toBeLessThan(0.2);
      // A polynomial spline through a regular polygon only approximates a
      // circle; allow its small, real curvature variation (unlike the generator).
      expect(measured.maxRollRateDegSec).toBeLessThan(0.2);
      expect(Math.abs(flightPose(route, 0).bankRad) * degrees).toBeGreaterThan(
        15,
      );
      const tangent = flightPose(route, 0).tangent;
      const later = flightPose(route, 100).tangent;
      expect(Math.sign(tangent.z * later.x - tangent.x * later.z)).toBe(
        Math.sign(flightPose(route, 0).bankRad),
      );
    }
  });

  it.each(["orbit", "eight", "rise"] as const)(
    "retains broad turns on %s without quick roll reversals",
    (id) => {
      const route = compileRoute(presetRoute(id));
      const measured = measure(route);
      expect(measured.maxRollRateDegSec).toBeLessThan(2);
      expect(measured.maxBankDeg).toBeGreaterThan(15);
      if (id === "eight") expect(measured.minBankDeg).toBeLessThan(-15);
    },
  );

  if (process.env.ROLL_REPORT) {
    it("records repeatable roll measurements for release comparison", () => {
      const routes = {
        circle: compileRoute(workshopSpec(circleRecipe, 1)),
        orbit: compileRoute(presetRoute("orbit")),
        eight: compileRoute(presetRoute("eight")),
        rise: compileRoute(presetRoute("rise")),
        workshop: compileRoute(workshopSpec(DEFAULT_WORKSHOP, 1)),
      };
      mkdirSync("output/roll", { recursive: true });
      writeFileSync(
        `output/roll/${process.env.ROLL_REPORT}.json`,
        JSON.stringify(
          Object.fromEntries(
            Object.entries(routes).map(([name, route]) => [
              name,
              {
                ...measure(route),
                durationMs: route.durationMs,
                positions: route.samples.map((s) => s.position),
                tangents: route.samples.map((s) => s.tangent),
                bank: Array.from(
                  { length: 1000 },
                  (_, i) =>
                    flightPose(route, (i / 1000) * route.durationMs).bankRad *
                    degrees,
                ),
              },
            ]),
          ),
          null,
          2,
        ),
      );
    });
  }
});
