import { expect, it, vi } from "vitest";
import { Experience } from "../packages/core/src";

it("tracks listener movement without event storms, while ignoring invalid poses", () => {
  const e = new Experience();
  const notify = vi.fn();
  e.subscribe(notify);
  const logCount = e.logs.length;
  const route = e.route.checksum;
  const pose = { x: 1, y: 1.25, z: -0.4 };
  for (let i = 0; i < 1000; i++) e.trackListener(pose);
  expect(e.listener).toEqual(pose);
  expect(e.listener).not.toBe(pose);
  expect(notify).not.toHaveBeenCalled();
  expect(e.logs.length).toBe(logCount);
  expect(e.route.checksum).toBe(route);
  e.trackListener({ x: NaN, y: 1, z: 0 });
  e.trackListener({ x: 0, y: Infinity, z: 0 });
  expect(e.listener).toEqual(pose);
});
