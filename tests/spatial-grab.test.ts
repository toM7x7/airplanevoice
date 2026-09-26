import { expect, it } from "vitest";
import * as THREE from "three";
import { nearModel, SpatialGrab } from "../apps/desktop/src/ui/spatial-grab";
import { xrWorkbench } from "../apps/desktop/src/XrWorkbench";
import { newCreation } from "../packages/core/src/creation";

it("keeps the picked point stable under rig rotation and moving hands", () => {
  const scene = new THREE.Group(),
    rig = new THREE.Group(),
    hand = new THREE.Group(),
    model = new THREE.Group();
  scene.add(rig, model);
  rig.position.set(2, 0, -3);
  rig.rotation.y = 0.7;
  rig.add(hand);
  hand.position.set(0.2, 1.4, -0.5);
  model.position.set(2, 1.3, -3.6);
  const before = model.position.clone(),
    grab = new SpatialGrab();
  grab.begin(model, hand);
  grab.update();
  expect(model.position.distanceTo(before)).toBeLessThan(1e-8);
  const oldHand = hand.getWorldPosition(new THREE.Vector3());
  hand.position.x += 0.2;
  grab.update();
  const delta = hand.getWorldPosition(new THREE.Vector3()).sub(oldHand);
  expect(model.position.distanceTo(before.add(delta))).toBeLessThan(1e-8);
  grab.end(hand);
  const released = model.position.clone();
  hand.position.x += 1;
  grab.update();
  expect(model.position.equals(released)).toBe(true);
});
it("accepts a finger just beside a thin wing and rejects distant empty space", () => {
  const model = new THREE.Group(),
    wing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.01, 0.08));
  model.add(wing);
  model.position.set(0, 1.5, -0.6);
  expect(nearModel(model, new THREE.Vector3(0.2, 1.53, -0.6))).toBe(true);
  expect(nearModel(model, new THREE.Vector3(0.8, 1.5, -0.6))).toBe(false);
});
it("keeps fly, AI and exit available in all editor categories without overlapping targets", () => {
  for (const tab of ["shape", "color", "sound", "name", "ai"] as const) {
    const panel = xrWorkbench({
      creation: newCreation("aircraft"),
      tab,
      setTab: () => {},
      run: () => {},
      canFly: true,
      message: "",
      voice: null,
      canAR: true,
      ar: false,
      home: () => {},
      exit: () => {},
    });
    expect(
      panel.buttons.some((b) => b.label === "この機体を飛ばす" && b.enabled),
    ).toBe(true);
    expect(panel.buttons.some((b) => b.label.endsWith("AI相談"))).toBe(true);
    expect(panel.buttons.some((b) => b.label === "空のメニューに戻る" && b.role === "navigation")).toBe(true);
    for (const [i, a] of panel.buttons.entries()) {
      expect(a.y + a.h).toBeLessThanOrEqual(416);
      for (const b of panel.buttons.slice(i + 1))
        expect(
          a.x < b.x + b.w &&
            b.x < a.x + a.w &&
            a.y < b.y + b.h &&
            b.y < a.y + a.h,
        ).toBe(false);
    }
  }
});
