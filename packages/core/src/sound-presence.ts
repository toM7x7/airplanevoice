export type SoundTraceMode = "soft" | "line" | "off";
export const TRACE_LABELS: Record<SoundTraceMode, string> = {
  soft: "音の厚み",
  line: "細い線",
  off: "表示しない",
};
/** A visual envelope at the historical emission position, timed to sound arrival. Not a sound-pressure measurement. */
export function soundPresence(ageMs: number, lifetimeMs: number, body = 1) {
  if (ageMs < 0 || ageMs >= lifetimeMs || lifetimeMs <= 0)
    return { opacity: 0, radius: 0 };
  const age = ageMs / lifetimeMs;
  const weight = Math.max(0, Math.min(1, body));
  return {
    opacity: (1 - Math.exp(-ageMs / 65)) * Math.pow(1 - age, 2.2),
    radius: (1.1 + weight * 1.3) * (1 + 0.32 * Math.sin(Math.PI * age)),
  };
}
