import { expect, it, vi } from "vitest";
import { xrMenuPage } from "../apps/desktop/src/ui/xr-menu-page";

it("keeps the return action in the same place as choices appear or disappear", () => {
  const back = vi.fn();
  for (const count of [0, 1, 3, 6]) {
    const page = xrMenuPage({
      title: "設定",
      status: "",
      detail: "",
      actions: Array.from({ length: count }, (_, i) => ({
        label: `設定${i}`,
        press: vi.fn(),
      })),
      back,
    });
    const returnButton = page.buttons.at(-1)!;
    expect([
      returnButton.x,
      returnButton.y,
      returnButton.w,
      returnButton.h,
    ]).toEqual([28, 351, 476, 56]);
    expect(returnButton.role).toBe("navigation");
    for (const b of page.buttons.slice(0, -1))
      expect(b.y + b.h).toBeLessThan(returnButton.y);
    returnButton.press();
  }
  expect(back).toHaveBeenCalledTimes(4);
});
