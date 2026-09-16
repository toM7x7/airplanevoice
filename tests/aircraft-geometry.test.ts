import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  fuselageGeometry,
  wingGeometry,
  intakeGeometry,
  intakeLipGeometry,
  exhaustGeometry,
} from "../apps/desktop/src/aircraft-geometry";

const bounds = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};
const hit = (
  g: THREE.BufferGeometry,
  origin: number[],
  direction: number[],
) => {
  const material = new THREE.MeshBasicMaterial(); // FrontSide: inward skins must fail.
  const mesh = new THREE.Mesh(g, material);
  mesh.updateMatrixWorld();
  const hits = new THREE.Raycaster(
    new THREE.Vector3(...origin),
    new THREE.Vector3(...direction),
  ).intersectObject(mesh);
  material.dispose();
  return hits;
};

describe("procedural airliner skin", () => {
  it("keeps recipe length and span in metres across the permitted editor range", () => {
    const body = fuselageGeometry(),
      left = wingGeometry(-1),
      right = wingGeometry(1);
    for (const length of [50, 71, 85]) {
      const box = bounds(body)
        .clone()
        .applyMatrix4(new THREE.Matrix4().makeScale(1, 1, length / 71));
      expect(box.max.z - box.min.z).toBeCloseTo(length, 4);
    }
    for (const span of [45, 64, 85]) {
      expect(
        ((bounds(right).max.x - bounds(left).min.x) * span) / 64,
      ).toBeCloseTo(span, 4);
    }
    [body, left, right].forEach((g) => g.dispose());
  });
  it("renders both mirrored wings and the fuselage from outside with finite normals", () => {
    const body = fuselageGeometry();
    expect(hit(body, [0, 0, 100], [0, 0, -1]).length).toBeGreaterThan(0);
    for (const side of [-1, 1]) {
      const wing = wingGeometry(side);
      expect(hit(wing, [side * 15, 20, -5], [0, -1, 0]).length).toBeGreaterThan(
        0,
      );
      expect(hit(wing, [side * 15, -20, -5], [0, 1, 0]).length).toBeGreaterThan(
        0,
      );
      for (const value of wing.getAttribute("normal").array)
        expect(Number.isFinite(value)).toBe(true);
      wing.dispose();
    }
    body.dispose();
  });
  it("leaves real depth behind the intake rim instead of sealing it with a front disc", () => {
    const lip = intakeLipGeometry(),
      chamber = intakeGeometry();
    const rim = hit(lip, [1.5, 0, 10], [0, 0, -1]);
    const cavity = hit(chamber, [0, 0, 10], [0, 0, -1]);
    expect(rim.length).toBeGreaterThan(0);
    expect(hit(lip, [0, 0, 10], [0, 0, -1])).toHaveLength(0);
    expect(cavity.length).toBeGreaterThan(0);
    expect(rim[0].point.z - cavity[0].point.z).toBeGreaterThan(1.5);
    lip.dispose();
    chamber.dispose();
  });
  it("keeps the exhaust skin visible from the side and behind", () => {
    const g = exhaustGeometry();
    expect(hit(g, [10, 0, -3.9], [-1, 0, 0]).length).toBeGreaterThan(0);
    expect(hit(g, [0.3, 0, -10], [0, 0, 1]).length).toBeGreaterThan(0);
    g.dispose();
  });
});
