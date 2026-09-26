import { compileRoute } from "./route";
import {
  DEFAULT_WORKSHOP,
  workshopSpec,
  type WorkshopRecipe,
} from "./workshop";
import type { Vec3 } from "./types";

/** Translate the compiled path, not an assumed generator radius. Physical scale stays 1:1. */
export function overheadRecipe(
  observer: Vec3,
  source: WorkshopRecipe = DEFAULT_WORKSHOP,
): WorkshopRecipe {
  const recipe = structuredClone(source);
  recipe.route = {
    ...DEFAULT_WORKSHOP.route,
    a: { x: -1000, z: -1000 },
    b: { x: 1000, z: -1000 },
    widthM: 1000,
    altitudeM: observer.y + 220,
    variation: 0,
  };
  recipe.flight = { speedMps: 52, bankResponseSec: 1.6 };
  const route = compileRoute(workshopSpec(recipe, 0));
  const near = route.samples.reduce((a, b) =>
    Math.hypot(a.position.x, a.position.z) <
    Math.hypot(b.position.x, b.position.z)
      ? a
      : b,
  ).position;
  for (const key of ["a", "b"] as const) {
    recipe.route[key].x += observer.x - near.x;
    recipe.route[key].z += observer.z - near.z;
  }
  const result = compileRoute(workshopSpec(recipe, 0));
  if (
    Math.min(
      ...result.samples.map((s) =>
        Math.hypot(s.position.x - observer.x, s.position.z - observer.z),
      ),
    ) > 5
  )
    throw new Error("この観察位置では頭上通過を準備できません。");
  return recipe;
}
