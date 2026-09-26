import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { nearPanelHandle } from "../apps/desktop/src/ui/panel-handles";
import { SpatialHandInput } from "../apps/desktop/src/ui/spatial-hand-input";

it("grabs either outer handle, not the menu header or buttons, under a rotated rig", () => {
  const rig = new THREE.Group(),
    panel = new THREE.Mesh();
  rig.position.set(4, 0, -7);
  rig.rotation.y = 0.8;
  rig.add(panel);
  panel.position.set(0, 1.4, -0.6);
  panel.scale.setScalar(0.3);
  const world = (x: number, y: number) =>
    panel.localToWorld(new THREE.Vector3(x, y, 0));
  for (const x of [-1.3, 1.3])
    expect(nearPanelHandle(panel, world(x, 0.05))).toBe(true);
  for (const [x, y] of [
    [0, 0.54],
    [0, 0],
    [0.8, 0.1],
    [1.8, 0.05],
  ])
    expect(nearPanelHandle(panel, world(x, y))).toBe(false);
});

it("requires a deliberate open then pinch and releases on tracking loss on either hand", () => {
  for (const handedness of ["left", "right"] as const) {
    const rig = new THREE.Group(),
      panel = new THREE.Mesh(),
      begin = vi.fn(() => true),
      end = vi.fn();
    let near = true;
    const input = new SpatialHandInput(rig, { near: () => near, begin, end });
    const index = {},
      thumb = {},
      wrist = {};
    const hand = new Map([
      ["index-finger-tip", index],
      ["thumb-tip", thumb],
      ["wrist", wrist],
    ]);
    const source = { hand, handedness } as unknown as XRInputSource;
    let separation = 0.01,
      tracked = true,
      offset = 0;
    const frame = {
      getJointPose: (joint: unknown) =>
        tracked
          ? {
              transform: {
                position: new THREE.Vector3(
                  offset + (joint === thumb ? separation : 0),
                  1.4,
                  -0.6,
                ),
                orientation: new THREE.Quaternion(),
              },
            }
          : null,
    } as unknown as XRFrame;
    const surface = {
      setTouchCursors: () => {},
      targetAt: () => null,
      select: () => false,
    };
    const update = () =>
      input.update(
        frame,
        {} as XRReferenceSpace,
        [source],
        panel,
        surface as never,
      );
    update();
    expect(begin).not.toHaveBeenCalled(); // closed at first acquisition
    separation = 0.08;
    update();
    separation = 0.01;
    update();
    expect(begin).toHaveBeenCalledTimes(1);
    tracked = false;
    update();
    expect(end).toHaveBeenCalled();
    tracked = true;
    update();
    expect(begin).toHaveBeenCalledTimes(1); // still pinched on return
    separation = 0.08;
    update();
    separation = 0.01;
    update();
    expect(begin).toHaveBeenCalledTimes(2);
    separation = 0.08;
    update();
    expect(input.diagnostics[0].grabbing).toBe(false);
    // Leave the handle and pinch within the contact retention interval.
    near = false;
    offset = 0.4;
    separation = 0.01;
    update();
    expect(begin).toHaveBeenCalledTimes(2);
    input.dispose();
  }
});

it("palm grip needs open-to-closed intent and follows the palm until release", () => {
  const rig = new THREE.Group(),
    panel = new THREE.Mesh(),
    begin = vi.fn(() => true),
    end = vi.fn();
  const input = new SpatialHandInput(rig, {
    near: () => false,
    palmNear: () => true,
    begin,
    end,
  });
  const names = [
    "index-finger-tip",
    "thumb-tip",
    "wrist",
    "middle-finger-metacarpal",
    "middle-finger-tip",
    "ring-finger-tip",
    "middle-finger-phalanx-proximal",
    "ring-finger-phalanx-proximal",
  ];
  const hand = new Map(names.map((n) => [n, { name: n }]));
  const source = { hand, handedness: "right" } as unknown as XRInputSource;
  let folded = 0.03;
  const frame = {
    getJointPose: (joint: { name: string }) => ({
      transform: {
        position: new THREE.Vector3(
          joint.name === "thumb-tip"
            ? 0.12
            : joint.name === "middle-finger-tip" ||
                joint.name === "ring-finger-tip"
              ? folded
              : 0,
          1.4,
          -0.6,
        ),
        orientation: new THREE.Quaternion(),
      },
    }),
  } as unknown as XRFrame;
  const surface = {
    setTouchCursors: () => {},
    targetAt: () => null,
    select: () => false,
  };
  const update = () =>
    input.update(
      frame,
      {} as XRReferenceSpace,
      [source],
      panel,
      surface as never,
    );
  update();
  expect(begin).not.toHaveBeenCalled();
  folded = 0.1;
  update();
  folded = 0.03;
  update();
  expect(begin).toHaveBeenCalledTimes(1);
  expect(input.diagnostics[0].gesture).toBe("palm");
  update();
  expect(begin).toHaveBeenCalledTimes(1);
  folded = 0.1;
  update();
  expect(input.diagnostics[0].grabbing).toBe(false);
  expect(end).toHaveBeenCalled();
  input.dispose();
});
