import * as THREE from "three";
import { DirectTouchGate } from "./direct-touch";
import type { SpatialControlSurface } from "./spatial-control-surface";

interface HandState {
  gate: DirectTouchGate;
  near: boolean;
  tip: number[] | null;
  presses: number;
  anchor: THREE.Group;
  pinching: boolean;
  armed: boolean;
  grabbing: boolean;
  nearObject: boolean;
  nearAt: number;
  handleAt: number;
  nearPoint: THREE.Vector3;
  palmArmed: boolean;
  holdingPalm: boolean;
}
export interface HandGrabTarget {
  near(point: THREE.Vector3): boolean;
  begin(anchor: THREE.Group, point: THREE.Vector3): boolean;
  end(anchor: THREE.Group): void;
  palmNear?(point: THREE.Vector3): boolean;
}

/** Shared room and component preview. XR select events provide the far pinch ray. */
export class SpatialHandInput {
  private states = new Map<XRInputSource, HandState>();
  private geometry = new THREE.SphereGeometry(1, 8, 6);
  private material = new THREE.MeshBasicMaterial({
    color: "#d5e7dc",
    transparent: true,
    opacity: 0.65,
  });
  private dots = new THREE.InstancedMesh(this.geometry, this.material, 50);
  private point = new THREE.Vector3();
  private local = new THREE.Vector3();
  private transform = new THREE.Object3D();
  private scale = new THREE.Vector3();
  constructor(
    private rig: THREE.Group,
    private grab?: HandGrabTarget,
    private drawJoints = true,
  ) {
    this.dots.frustumCulled = false;
    this.dots.count = 0;
    rig.add(this.dots);
  }
  allowPinch(source: XRInputSource) {
    const hand = this.states.get(source);
    if (
      !hand?.tip ||
      hand.near ||
      hand.nearObject ||
      hand.grabbing ||
      performance.now() - hand.nearAt < 180
    )
      return false;
    // A far pinch cannot also become a near touch without withdrawing first.
    hand.gate.consume();
    return true;
  }
  isNear(source: XRInputSource) {
    return this.states.get(source)?.near ?? false;
  }
  reset() {
    for (const state of this.states.values()) {
      this.grab?.end(state.anchor);
      state.anchor.removeFromParent();
    }
    this.states.clear();
    this.dots.count = 0;
  }
  update(
    frame: XRFrame,
    reference: XRReferenceSpace,
    sources: readonly XRInputSource[],
    panel: THREE.Mesh,
    surface: SpatialControlSurface,
  ) {
    const active = new Set(sources.filter((s) => s.hand));
    for (const source of this.states.keys())
      if (!active.has(source)) {
        const state = this.states.get(source)!;
        this.grab?.end(state.anchor);
        state.anchor.removeFromParent();
        this.states.delete(source);
      }
    panel.updateWorldMatrix(true, false);
    panel.getWorldScale(this.scale);
    let count = 0;
    const cursors: { x: number; y: number }[] = [];
    for (const source of active) {
      let state = this.states.get(source);
      if (!state) {
        state = {
          gate: new DirectTouchGate(),
          near: false,
          tip: null,
          presses: 0,
          anchor: new THREE.Group(),
          pinching: false,
          armed: false,
          grabbing: false,
          nearObject: false,
          nearAt: -Infinity,
          handleAt: -Infinity,
          nearPoint: new THREE.Vector3(),
          palmArmed: false,
          holdingPalm: false,
        };
        this.rig.add(state.anchor);
        this.states.set(source, state);
      }
      state.tip = null;
      state.near = false;
      const joint = source.hand!.get("index-finger-tip");
      const pose = joint && frame.getJointPose?.(joint, reference);
      if (!pose) {
        this.grab?.end(state.anchor);
        state.pinching = state.grabbing = state.nearObject = false;
        state.armed = false;
        state.palmArmed = state.holdingPalm = false;
        state.nearAt = -Infinity;
        state.handleAt = -Infinity;
        state.gate.reset();
        continue;
      }
      for (const space of this.drawJoints ? source.hand!.values() : []) {
        const p = frame.getJointPose?.(space, reference);
        if (!p || count >= 50) continue;
        this.transform.position.copy(p.transform.position);
        this.transform.scale.setScalar(
          Math.min(0.004, Math.max(0.0025, (p.radius || 0.008) * 0.35)),
        );
        this.transform.updateMatrix();
        this.dots.setMatrixAt(count++, this.transform.matrix);
      }
      this.point
        .copy(pose.transform.position)
        .applyMatrix4(this.rig.matrixWorld);
      state.tip = this.point.toArray();
      const thumb = source.hand!.get("thumb-tip");
      const thumbPose = thumb && frame.getJointPose?.(thumb, reference);
      if (thumbPose && this.grab) {
        const jointPose = (name: XRHandJoint) => {
          const space = source.hand!.get(name);
          return space && frame.getJointPose?.(space, reference);
        };
        const base = jointPose("middle-finger-metacarpal"),
          middle = jointPose("middle-finger-tip"),
          ring = jointPose("ring-finger-tip");
        const middleBase = jointPose("middle-finger-phalanx-proximal"),
          ringBase = jointPose("ring-finger-phalanx-proximal");
        const folded =
          middle && middleBase && ring && ringBase
            ? Math.max(
                new THREE.Vector3()
                  .copy(middle.transform.position)
                  .distanceTo(middleBase.transform.position),
                new THREE.Vector3()
                  .copy(ring.transform.position)
                  .distanceTo(ringBase.transform.position),
              )
            : Infinity;
        if (folded > 0.075 && Number.isFinite(folded)) state.palmArmed = true;
        const palmClosed = folded < (state.holdingPalm ? 0.075 : 0.052);
        const palmPoint = base
          ? new THREE.Vector3()
              .copy(base.transform.position)
              .applyMatrix4(this.rig.matrixWorld)
          : null;
        const palmNear = !!palmPoint && !!this.grab.palmNear?.(palmPoint);
        const usePalm =
          state.holdingPalm ||
          (!state.grabbing && palmClosed && state.palmArmed && palmNear);
        state.anchor.position
          .copy(pose.transform.position)
          .add(thumbPose.transform.position)
          .multiplyScalar(0.5);
        if (usePalm && base)
          state.anchor.position.copy(base.transform.position);
        const wrist = source.hand!.get("wrist");
        const wristPose = wrist && frame.getJointPose?.(wrist, reference);
        state.anchor.quaternion.copy((wristPose ?? pose).transform.orientation);
        state.anchor.updateWorldMatrix(true, false);
        this.local.setFromMatrixPosition(state.anchor.matrixWorld);
        state.nearObject = this.grab.near(this.local) || palmNear;
        if (state.nearObject) {
          state.nearAt = performance.now();
          const handle = !!this.grab.palmNear?.(this.local);
          if (handle) state.handleAt = performance.now();
          // A closing pinch can shift into the neighbouring miniature. Keep the handle
          // the open hand just touched instead of silently grabbing the aircraft.
          if (
            handle ||
            performance.now() - state.handleAt > 300 ||
            this.local.distanceTo(state.nearPoint) > 0.1
          )
            state.nearPoint.copy(this.local);
        }
        const separation = new THREE.Vector3()
          .copy(pose.transform.position)
          .distanceTo(thumbPose.transform.position);
        const pinching = separation < (state.pinching ? 0.055 : 0.035);
        if (separation >= 0.055) state.armed = true;
        if (usePalm && !state.grabbing && palmPoint) {
          state.grabbing = this.grab.begin(state.anchor, palmPoint);
          state.holdingPalm = state.grabbing;
          state.palmArmed = false;
        }
        // Closing finger/thumb shifts their midpoint. Retain the contact for that short motion.
        if (
          pinching &&
          !state.grabbing &&
          state.armed &&
          !state.pinching &&
          this.local.distanceTo(state.nearPoint) <= 0.08 &&
          performance.now() - state.nearAt < 300
        )
          state.grabbing = this.grab.begin(state.anchor, state.nearPoint);
        if (state.grabbing && (state.holdingPalm ? !palmClosed : !pinching)) {
          this.grab.end(state.anchor);
          state.grabbing = false;
          state.holdingPalm = false;
        }
        state.pinching = pinching;
        if (pinching) state.armed = false;
      } else {
        this.grab?.end(state.anchor);
        state.pinching = state.grabbing = state.nearObject = false;
        state.armed = false;
        state.palmArmed = state.holdingPalm = false;
      }
      if (state.grabbing || state.nearObject) {
        state.gate.consume();
        continue;
      }
      if (!panel.visible) {
        state.gate.reset();
        continue;
      }
      this.local.copy(this.point);
      panel.worldToLocal(this.local);
      const x = (this.local.x / 2.4 + 0.5) * 1024;
      const y = (0.5 - this.local.y / 1.2) * 512;
      const depth = this.local.z * this.scale.z;
      const inBounds = x >= 0 && x <= 1024 && y >= 0 && y <= 512;
      state.near = inBounds && depth > -0.05 && depth < 0.12;
      const target = inBounds ? surface.targetAt(x, y) : null;
      if (state.near && target) cursors.push({ x, y });
      if (state.gate.update(target, depth)) {
        surface.select(x, y);
        state.presses++;
      }
    }
    this.dots.count = count;
    this.dots.instanceMatrix.needsUpdate = true;
    surface.setTouchCursors(cursors);
  }
  get diagnostics() {
    return [...this.states].map(([source, state]) => ({
      hand: source.handedness,
      tracked: !!state.tip,
      near: state.near,
      tip: state.tip,
      presses: state.presses,
      grip: state.anchor.getWorldPosition(new THREE.Vector3()).toArray(),
      grabbing: state.grabbing,
      gesture: state.holdingPalm ? "palm" : state.grabbing ? "pinch" : null,
      nearObject: state.nearObject,
    }));
  }
  dispose() {
    this.reset();
    this.dots.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.dots.dispose();
  }
}
