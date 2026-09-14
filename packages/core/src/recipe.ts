import type { EngineRecipe } from "./types";
export function selectRecipe(lap: number, delayScale = 1.6): EngineRecipe {
  // A single audible change on alternating laps; flight constraints stay fixed.
  return {
    schemaVersion: "1.0",
    id: lap % 2 ? "deep-return" : "clear-morning",
    delayScale,
    trailPersistenceSec: 4.5,
    trailOpacity: 0.32,
    lowFrequencyGain: lap % 2 ? 0.8 : 0.55,
  };
}
export function validRecipe(value: unknown): value is EngineRecipe {
  if (!value || typeof value !== "object") return false;
  const r = value as EngineRecipe;
  return (
    r.schemaVersion === "1.0" &&
    ["clear-morning", "deep-return"].includes(r.id) &&
    Number.isFinite(r.delayScale) &&
    r.delayScale >= 1 &&
    r.delayScale <= 3 &&
    Number.isFinite(r.trailPersistenceSec) &&
    r.trailPersistenceSec >= 1 &&
    r.trailPersistenceSec <= 8 &&
    Number.isFinite(r.trailOpacity) &&
    r.trailOpacity >= 0 &&
    r.trailOpacity <= 0.5 &&
    Number.isFinite(r.lowFrequencyGain) &&
    r.lowFrequencyGain >= 0 &&
    r.lowFrequencyGain <= 1
  );
}
