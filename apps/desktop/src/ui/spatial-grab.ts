import * as THREE from "three";

/** World-space grip, preserving the picked point even under a transformed rig. */
export class SpatialGrab {
  private anchor: THREE.Object3D | null = null;
  private target: THREE.Object3D | null = null;
  private relative = new THREE.Matrix4();
  private world = new THREE.Matrix4();
  begin(target: THREE.Object3D, anchor: THREE.Object3D) {
    if (this.target) return false;
    target.updateWorldMatrix(true, false);
    anchor.updateWorldMatrix(true, false);
    this.relative
      .copy(anchor.matrixWorld)
      .invert()
      .multiply(target.matrixWorld);
    this.target = target;
    this.anchor = anchor;
    return true;
  }
  update() {
    if (!this.target || !this.anchor) return;
    this.anchor.updateWorldMatrix(true, false);
    this.world.copy(this.anchor.matrixWorld).multiply(this.relative);
    if (this.target.parent) {
      this.target.parent.updateWorldMatrix(true, false);
      this.world.premultiply(this.target.parent.matrixWorld.clone().invert());
    }
    this.world.decompose(
      this.target.position,
      this.target.quaternion,
      this.target.scale,
    );
  }
  end(anchor?: THREE.Object3D) {
    if (!anchor || this.anchor === anchor) this.target = this.anchor = null;
  }
  get active() {
    return !!this.target;
  }
}

/** Padded bounds for each real mesh: wings and engines count, distant empty corners do not. */
export function nearModel(
  model: THREE.Object3D,
  point: THREE.Vector3,
  padding = 0.045,
) {
  model.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  let hit = false;
  model.traverse((part) => {
    if (
      hit ||
      !(part instanceof THREE.Mesh) ||
      !part.visible ||
      part.userData.grabOnly
    )
      return;
    if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
    if (!part.geometry.boundingBox) return;
    box
      .copy(part.geometry.boundingBox)
      .applyMatrix4(part.matrixWorld)
      .expandByScalar(padding);
    hit = box.containsPoint(point);
  });
  return hit;
}
