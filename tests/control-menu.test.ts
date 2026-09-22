import { describe, expect, it } from "vitest";
import {
  activateControl,
  ControlMenuState,
  controlMenuView,
  DisclosureMotion,
  type ControlContext,
} from "../apps/desktop/src/ui/control-menu";

const noop = () => {};
const context: ControlContext = {
  flying: false,
  soundOn: false,
  audioPending: false,
  volume: 35,
  selected: false,
  xr: false,
  canShowAR: false,
  ar: false,
  start: noop,
  sound: noop,
  volumeChange: noop,
  clear: noop,
  environment: noop,
  exit: noop,
};
describe("control components", () => {
  it("keeps unavailable commands inert through the shared activation path", () => {
    let calls = 0;
    const menu = new ControlMenuState();
    menu.go("view");
    const view = controlMenuView(menu, {
      ...context,
      environment: () => calls++,
    });
    const environment = view.actions.find((a) => a.id === "view.environment")!;
    expect(activateControl(environment)).toBe(false);
    expect(calls).toBe(0);
    expect(menu.snapshot.open).toBe(true);
    const available = controlMenuView(menu, {
      ...context,
      canShowAR: true,
      environment: () => calls++,
    }).actions[0];
    expect(activateControl(available)).toBe(true);
    expect(calls).toBe(1);
    expect(menu.snapshot.open).toBe(false);
  });
  it("reverses an interrupted animation and settles at the latest intent", () => {
    const m = new DisclosureMotion();
    m.update(true, 0.08, false);
    const partial = m.progress;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
    m.update(false, 0.02, false);
    expect(m.progress).toBeLessThan(partial);
    for (let i = 0; i < 40; i++) m.update(true, 0.05, false);
    expect(m.progress).toBe(1);
    m.update(false, 0, true);
    expect(m.progress).toBe(0);
    m.update(true, 0, true);
    expect(m.progress).toBe(1);
  });
  it("reports audio setup and volume boundaries without dispatching duplicate work", () => {
    let calls = 0;
    const menu = new ControlMenuState();
    menu.go("sound");
    const view = controlMenuView(menu, {
      ...context,
      volume: 70,
      audioPending: true,
      sound: () => calls++,
      volumeChange: () => calls++,
    });
    expect(activateControl(view.dock[1])).toBe(false);
    expect(
      activateControl(view.actions.find((a) => a.id === "sound.louder")!),
    ).toBe(false);
    expect(calls).toBe(0);
  });
});
