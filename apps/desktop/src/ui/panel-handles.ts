import * as THREE from "three";

/** Outside the button surface, so an ordinary menu pinch cannot drag the board. */
export const PANEL_HANDLES = [-1.3, 1.3] as const;
export function nearPanelHandle(panel: THREE.Object3D, point: THREE.Vector3) {
  panel.updateWorldMatrix(true, false);
  const local = panel.worldToLocal(point.clone());
  const scale = panel.getWorldScale(new THREE.Vector3());
  // Test in panel coordinates: rotating a board must not turn its whole bounding box into a grip.
  // Keep the actual button surface out of the generous contact volume.
  if (Math.abs(local.x) < 1.2) return false;
  return PANEL_HANDLES.some((x) => {
    const bounds = new THREE.Box3(
      new THREE.Vector3(
        x - 0.055 - 0.045 / scale.x,
        -0.2 - 0.045 / scale.y,
        -0.1 / scale.z,
      ),
      new THREE.Vector3(
        x + 0.055 + 0.045 / scale.x,
        0.3 + 0.045 / scale.y,
        0.1 / scale.z,
      ),
    );
    return bounds.containsPoint(local);
  });
}
export function highlightPanelHandles(group: THREE.Group, on: boolean) {
  group.children.forEach((child) => {
    if (
      child instanceof THREE.Mesh &&
      child.geometry instanceof THREE.BoxGeometry
    )
      (child.material as THREE.MeshBasicMaterial).color.set(
        on ? "#d2ac50" : "#247871",
      );
  });
}
export function createPanelHandles() {
  const group = new THREE.Group();
  for (const x of PANEL_HANDLES) {
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.5, 0.05),
      new THREE.MeshBasicMaterial({ color: "#247871" }),
    );
    handle.position.set(x, 0.05, 0.01);
    group.add(handle);
    for (const y of [-0.1, 0, 0.1])
      for (const dx of [-0.025, 0.025]) {
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.011, 6, 4),
          new THREE.MeshBasicMaterial({ color: "#eef4ed" }),
        );
        dot.position.set(x + dx, y + 0.05, 0.05);
        group.add(dot);
      }
  }
  return group;
}
