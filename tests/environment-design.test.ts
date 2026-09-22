import { it, expect } from "vitest";
import {
  environmentPreset,
  environmentObjects,
  checkedEnvironment,
  changeEnvironment,
} from "../packages/core/src/environment";
import { changeRoom, newRoom } from "../packages/core/src/shared-room";
import {
  newCreation,
  changeCreation,
  isCreationAction,
} from "../packages/core/src/creation";
import {
  DESIGN_CHOICES,
  designProposal,
} from "../packages/core/src/design-assistant";
import { TYPESAFE_MODEL } from "../packages/core/src/ai-intent";
import { parseWorkshop } from "../packages/core/src/workshop";
it("creates reproducible bounded assets with clear central view and airfield", () => {
  const r = environmentPreset("city"),
    objects = environmentObjects(r);
  expect(objects).toEqual(environmentObjects(r));
  expect(objects.buildings.length).toBeGreaterThan(20);
  expect(objects.buildings.length + objects.trees.length).toBeLessThanOrEqual(
    121,
  );
  expect(
    objects.buildings.every(
      (b) =>
        Math.abs(b.x) > r.streetWidthM / 2 + 12 && !(b.z > -450 && b.z < -85),
    ),
  ).toBe(true);
  expect(objects).not.toEqual(environmentObjects({ ...r, seed: 13 }));
  expect(() => checkedEnvironment({ ...r, heightM: 500 })).toThrow();
  expect(() => changeEnvironment(r, "density:NaN")).toThrow();
  const state = changeRoom(
    newRoom(1),
    { id: "world-change", type: "environment", environment: r, revision: 0 },
    2,
  );
  expect(state.environment).toEqual(r);
  expect(state.flights).toEqual([]);
});
it("round trips richer aircraft and rejects invalid atomic designs without mutation", () => {
  const old = newCreation("my-aircraft");
  let c = changeCreation(old, "shape:5");
  for (const action of [
    "width:7.4",
    "sweep:38",
    "winglet:2.1",
    "engineSize:1.25",
    "engines:4",
    "paint:#ffddaa",
    "accent:#334455",
  ])
    c = changeCreation(c, action);
  expect(parseWorkshop(JSON.stringify(c.entry.recipe))).toEqual(c.entry.recipe);
  expect(c.entry.recipe.aircraft.bodyWidthM).toBe(7.4);
  expect(old.entry.recipe.aircraft.bodyWidthM).toBeUndefined();
  expect(isCreationAction("engineSize:9")).toBe(false);
  expect(isCreationAction('design:{"bodyLengthM":1000}')).toBe(false);
  expect(
    changeCreation(old, `design:${JSON.stringify(c.entry.recipe.aircraft)}`)
      .entry.recipe.aircraft,
  ).toEqual(c.entry.recipe.aircraft);
});
it("Jev chooses only declared design options and malformed or uncertain replies have no effect", () => {
  const current = newCreation("my-aircraft").entry.recipe.aircraft;
  const answers = Object.fromEntries(
    Object.entries(DESIGN_CHOICES).map(([name, criteria]) => [
      name,
      {
        type: "choice",
        choice: name === "shape" ? "shape_3" : "keep",
        confidence: 0.95,
        probabilities: Object.fromEntries(
          Object.keys(criteria).map((key) => [
            key,
            key === (name === "shape" ? "shape_3" : "keep") ? 1 : 0,
          ]),
        ),
      },
    ]),
  );
  expect(
    designProposal({ model: TYPESAFE_MODEL, answers }, current)?.bodyLengthM,
  ).toBe(55);
  answers.engines.confidence = 0.1;
  expect(
    designProposal({ model: TYPESAFE_MODEL, answers }, current),
  ).toBeNull();
  answers.engines.confidence = 1;
  answers.engines.choice = "execute_code";
  expect(
    designProposal({ model: TYPESAFE_MODEL, answers }, current),
  ).toBeNull();
});
