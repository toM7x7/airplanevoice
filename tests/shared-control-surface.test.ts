import { afterEach, expect, it, vi } from "vitest";
import { SharedControlSurface } from "../apps/desktop/src/ui/shared-control-surface";
import type { SharedVrPanel } from "../apps/desktop/src/vr";

afterEach(() => vi.unstubAllGlobals());
it("collapsed controls let aircraft rays pass while the dock remains usable; stale pages cannot execute", () => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
  vi.stubGlobal("Path2D", class {});
  // Drawing is incidental here; exercise the real hit regions and input lifecycle.
  const ctx = new Proxy(
    { measureText: (text: string) => ({ width: text.length * 20 }) },
    {
      get: (o, k) => Reflect.get(o, k) ?? (() => {}),
      set: (o, k, v) => Reflect.set(o, k, v),
    },
  ) as unknown as CanvasRenderingContext2D;
  const press = vi.fn(),
    recenter = vi.fn();
  let panel: SharedVrPanel = {
    title: "音",
    status: "",
    detail: "",
    buttons: [{ label: "音量", x: 0, y: 0, w: 1, h: 1, press }],
  };
  const surface = new SharedControlSurface(() => panel, recenter);
  surface.draw(ctx, 1);
  expect(surface.targetAt(100, 180)).not.toBeNull();
  surface.close();
  surface.draw(ctx, 1);
  expect(surface.targetAt(100, 180)).toBeNull();
  expect(surface.select(100, 180)).toBe(false);
  expect(press).not.toHaveBeenCalled();
  expect(surface.select(200, 470)).toBe(true);
  surface.draw(ctx, 1);
  expect(surface.targetAt(100, 180)).not.toBeNull();
  panel = { ...panel, title: "別ページ" };
  surface.select(100, 180);
  expect(press).not.toHaveBeenCalled();
  surface.draw(ctx, 1);
  surface.select(100, 180);
  expect(press).toHaveBeenCalledOnce();
  surface.select(700, 470);
  expect(recenter).toHaveBeenCalledOnce();
});
