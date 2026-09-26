import { describe, expect, it } from "vitest";
import { DirectTouchGate } from "../apps/desktop/src/ui/direct-touch";

describe("direct touch approach and release", () => {
  it("requires a front approach, fires once and rearms only after withdrawal", () => {
    const g = new DirectTouchGate();
    expect(g.update("menu", 0.002)).toBeNull();
    expect(g.update("menu", 0.07)).toBeNull();
    expect(g.update("menu", 0.007)).toBe("menu");
    expect(g.update("menu", 0.004)).toBeNull();
    expect(g.update("next-page-button", 0.002)).toBeNull();
    g.update("next-page-button", 0.06);
    expect(g.update("next-page-button", 0.006)).toBe("next-page-button");
  });
  it("does not press from the back, after lost tracking, or by sliding to a different button", () => {
    const g = new DirectTouchGate();
    g.update("menu", -0.07);
    expect(g.update("menu", 0.006)).toBeNull();
    g.update("menu", 0.07);
    g.update(null, null);
    expect(g.update("menu", 0.006)).toBeNull();
    g.update("menu", 0.07);
    expect(g.update("other", 0.006)).toBeNull();
    expect(g.update("menu", 0.006)).toBeNull();
  });
  it("consumes a pinch so one physical action cannot also become a touch", () => {
    const g = new DirectTouchGate();
    g.update("sound", 0.05);
    g.consume();
    expect(g.update("sound", 0.007)).toBeNull();
    g.update("sound", 0.06);
    expect(g.update("sound", 0.007)).toBe("sound");
  });
});
