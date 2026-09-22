/** Pure time-based choreography shared by live controls, spatial canvas and film. */
export type MenuMotionStyle = "lift" | "trail" | "ripple";
export const OPEN_SECONDS = 1.65;
export const CLOSE_SECONDS = 0.65;
export const clamp01 = (n: number) =>
  Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const ease = (n: number) => 1 - (1 - clamp01(n)) ** 3;
const phase = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
export interface MenuPose {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  opacity: number;
}
export function menuMotion(style: MenuMotionStyle, progress: number) {
  const p = clamp01(progress);
  const e = ease(p);
  const board: MenuPose = { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 };
  const cards: MenuPose[] = Array.from({ length: 4 }, (_, i) => {
    const t = ease(
      phase(p, style === "trail" ? 0.12 + i * 0.12 : i * 0.05, 0.9),
    );
    if (style === "lift")
      return {
        x: (i % 2 ? -0.3 : 0.3) * (1 - t),
        y: (i < 2 ? 0.8 : 0.43) * (1 - t) - Math.sin(t * Math.PI) * 0.18,
        rotation: (i % 2 ? 62 : -62) * (1 - t),
        scale: 0.35 + 0.65 * t,
        opacity: phase(p, i * 0.05, 0.2 + i * 0.05),
      };
    if (style === "trail")
      return {
        x: -0.6 * (1 - t),
        y: 0.12 * (1 - t),
        rotation: 0,
        scale: 1,
        opacity: phase(p, 0.12 + i * 0.12, 0.32 + i * 0.12),
      };
    return {
      x: (i % 2 ? -0.15 : 0.15) * (1 - t),
      y: 0.2 * (1 - t),
      rotation: 0,
      scale: 0.15 + 0.85 * t,
      opacity: phase(p, 0.2 + i * 0.035, 0.55 + i * 0.035),
    };
  });
  if (style === "lift") {
    board.y = 0.16 * (1 - e);
    board.opacity = phase(p, 0.42, 0.9);
  }
  if (style === "trail") {
    board.x = -0.22 * (1 - e);
    board.opacity = phase(p, 0.1, 0.65);
  }
  if (style === "ripple") {
    board.scale = 0.42 + 0.58 * ease(phase(p, 0.18, 0.95));
    board.opacity = phase(p, 0.22, 0.7);
  }
  return {
    progress: p,
    board,
    cards,
    headerOpacity: phase(p, 0.5, 0.95),
    sweep: ease(phase(p, 0, 0.8)),
    effectOpacity: Math.sin(Math.PI * p),
    rings: [0, 1, 2].map((i) => ({
      radius: phase(p, 0.07 + i * 0.12, 0.72 + i * 0.12),
      opacity:
        (1 - phase(p, 0.38 + i * 0.1, 0.78 + i * 0.1)) *
        phase(p, 0.07 + i * 0.12, 0.17 + i * 0.12),
    })),
  };
}
/** Nine-second review: open, rest, close, reopen. No browser clock dependencies. */
export function reviewProgress(seconds: number) {
  if (seconds < 0.75) return 0;
  if (seconds < 4.6) return clamp01((seconds - 0.75) / OPEN_SECONDS);
  if (seconds < 5.9) return 1 - clamp01((seconds - 4.6) / CLOSE_SECONDS);
  return clamp01((seconds - 5.9) / OPEN_SECONDS);
}
