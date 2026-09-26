import { describe, expect, it } from "vitest";
import {
  beginVolumeGuide,
  describeControlGuide,
} from "../apps/desktop/src/ui/control-guide";
import { ControlMenuState } from "../apps/desktop/src/ui/control-menu";

describe("manual operation guidance", () => {
  it("finds the visible prerequisite, including a reopened non-home page", () => {
    const menu = new ControlMenuState();
    const session = beginVolumeGuide(35, 0);
    const view = () =>
      describeControlGuide(
        session,
        menu.snapshot,
        { volume: 35, soundOn: false },
        1,
      );
    expect(view().target).toEqual({
      actionId: "menu.toggle",
      location: "dock",
    });
    menu.go("view");
    expect(view().target?.actionId).toBe("menu.home");
    menu.go("home");
    expect(view().target?.actionId).toBe("menu.sound");
    menu.go("sound");
    expect(view().target).toEqual({
      actionId: "sound.louder",
      location: "panel",
    });
    menu.close();
    expect(view().target?.actionId).toBe("menu.toggle");
  });
  it("requires an actual setting change and distinguishes playback from volume", () => {
    const menu = new ControlMenuState();
    menu.go("sound");
    const session = beginVolumeGuide(35, 0);
    expect(
      describeControlGuide(
        session,
        menu.snapshot,
        { volume: 35, soundOn: true },
        1,
      ).status,
    ).toBe("active");
    expect(
      describeControlGuide(
        session,
        menu.snapshot,
        { volume: 30, soundOn: false },
        1,
      ).status,
    ).toBe("active");
    const done = describeControlGuide(
      session,
      menu.snapshot,
      { volume: 40, soundOn: false },
      1,
    );
    expect(done.status).toBe("complete");
    expect(done.target).toBeUndefined();
    expect(done.detail).toContain("再生は停止中");
  });
  it("does not guide to a disabled volume limit or leave an expired target", () => {
    const menu = new ControlMenuState();
    menu.go("sound");
    const session = beginVolumeGuide(70, 0);
    expect(
      describeControlGuide(
        session,
        menu.snapshot,
        { volume: 70, soundOn: false },
        1,
      ).target?.actionId,
    ).toBe("sound.quieter");
    const expired = describeControlGuide(
      session,
      menu.snapshot,
      { volume: 70, soundOn: false },
      120_000,
    );
    expect(expired.status).toBe("expired");
    expect(expired.target).toBeUndefined();
  });
});
