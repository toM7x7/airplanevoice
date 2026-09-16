import * as THREE from "three";

type Station = readonly [z: number, width: number, height: number];
const BODY: readonly Station[] = [
  [-35.5, 0.04, 0.06],
  [-32, 0.65, 0.8],
  [-27, 1.75, 1.95],
  [-20, 2.85, 2.95],
  [-12, 3.25, 3.3],
  [8, 3.3, 3.3],
  [20, 3.27, 3.25],
  [25, 3.05, 3],
  [29, 2.77, 2.52],
  [32, 2.18, 1.92],
  [34, 1.38, 1.1],
  [35.1, 0.68, 0.49],
  [35.5, 0.04, 0.04],
];
function sectionAt(z: number) {
  const i = Math.max(0, BODY.findIndex((s) => s[0] >= z) - 1);
  const a = BODY[i],
    b = BODY[i + 1];
  const t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
  const prev = BODY[Math.max(0, i - 1)],
    next = BODY[Math.min(BODY.length - 1, i + 2)];
  const interpolate = (axis: 1 | 2) => {
    const m0 = (b[axis] - prev[axis]) / (b[0] - prev[0]);
    const m1 = (next[axis] - a[axis]) / (next[0] - a[0]);
    return (
      (2 * t * t * t - 3 * t * t + 1) * a[axis] +
      (t * t * t - 2 * t * t + t) * m0 * (b[0] - a[0]) +
      (-2 * t * t * t + 3 * t * t) * b[axis] +
      (t * t * t - t * t) * m1 * (b[0] - a[0])
    );
  };
  return [interpolate(1), interpolate(2)];
}

/** Nominal 71m body. +Z forward; the upper deck is part of the continuous skin. */
export function bodySurface(z: number, angle: number, offset = 0) {
  const [width, height] = sectionAt(z);
  const top = Math.max(0, Math.sin(angle));
  const deck = 0.95 * Math.exp(-Math.pow((z - 18) / 10, 4)) * Math.pow(top, 4);
  const center =
    0.65 * THREE.MathUtils.smoothstep(-z, 20, 35.5) -
    0.6 * THREE.MathUtils.smoothstep(z, 27, 35.5);
  return new THREE.Vector3(
    (width + offset) * Math.cos(angle),
    center + (height + offset) * Math.sin(angle) + deck,
    z,
  );
}

// Shared vertices make a smooth closed skin, including mirrored lifting surfaces.
function loft(rings: THREE.Vector3[][]) {
  const count = rings[0].length;
  const points = rings.flatMap((ring) => ring.flatMap((p) => p.toArray()));
  const indices: number[] = [];
  for (let i = 0; i < rings.length - 1; i++)
    for (let j = 0; j < count; j++) {
      const a = i * count + j,
        b = i * count + ((j + 1) % count);
      indices.push(a, b, b + count, a, b + count, a + count);
    }
  for (const end of [0, rings.length - 1]) {
    const center = new THREE.Vector3();
    for (const p of rings[end]) center.add(p);
    center.divideScalar(count);
    const index = points.length / 3;
    points.push(...center.toArray());
    for (let j = 0; j < count; j++) {
      const a = end * count + j,
        b = end * count + ((j + 1) % count);
      indices.push(index, end === 0 ? b : a, end === 0 ? a : b);
    }
  }
  let volume = 0;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let i = 0; i < indices.length; i += 3) {
    a.fromArray(points, indices[i] * 3);
    b.fromArray(points, indices[i + 1] * 3);
    c.fromArray(points, indices[i + 2] * 3);
    volume += a.dot(b.cross(c));
  }
  if (volume < 0)
    for (let i = 0; i < indices.length; i += 3)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function fuselageGeometry() {
  const rings = Array.from({ length: 65 }, (_, i) =>
    Array.from({ length: 40 }, (_, j) =>
      bodySurface(-35.5 + (i / 64) * 71, (j / 40) * Math.PI * 2),
    ),
  );
  const g = loft(rings),
    positions = g.getAttribute("position"),
    colors: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    const belly = 1 - THREE.MathUtils.smoothstep(positions.getY(i), -1.9, -0.5);
    colors.push(1 - belly * 0.15, 1 - belly * 0.12, 1 - belly * 0.09);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

// span, leading Z, trailing Z, dihedral height, thickness/chord.
const MAIN_WING = [
  [2.2, 7, -12, -0.9, 0.12],
  [5.5, 5.5, -12, -0.6, 0.12],
  [12, 1.5, -11.8, -0.1, 0.105],
  [22, -4.6, -12.8, 0.75, 0.085],
  [29.5, -8.9, -13.4, 1.8, 0.065],
  [32, -10.8, -13.5, 2.6, 0.05],
];
const TAIL = [
  [1.4, -22, -31, 1.1, 0.1],
  [7, -26, -33, 1.7, 0.09],
  [14, -30.5, -34, 2.6, 0.055],
];
const FIN = [
  [1.5, -19, -34, 0, 0.095],
  [6, -24, -35, 0, 0.085],
  [12.7, -30.3, -35.4, 0, 0.06],
];
export function wingGeometry(
  side: number,
  kind: "main" | "tail" | "fin" = "main",
) {
  const stations = kind === "main" ? MAIN_WING : kind === "tail" ? TAIL : FIN;
  return loft(
    stations.map(([span, leading, trailing, rise, ratio]) =>
      Array.from({ length: 32 }, (_, i) => {
        const angle = (i / 32) * Math.PI * 2,
          u = (1 - Math.cos(angle)) / 2,
          chord = leading - trailing;
        // Closed trailing edge and rounded nose. Vertical tail is symmetric.
        const thickness =
          5 *
          ratio *
          chord *
          (0.2969 * Math.sqrt(u) -
            0.126 * u -
            0.3516 * u * u +
            0.2843 * u * u * u -
            0.1036 * u * u * u * u);
        const cross =
          Math.sign(Math.sin(angle)) * thickness +
          (kind === "fin" ? 0 : Math.sin(u * Math.PI) * chord * 0.012);
        return kind === "fin"
          ? new THREE.Vector3(cross, span, leading - chord * u)
          : new THREE.Vector3(side * span, rise + cross, leading - chord * u);
      }),
    ),
  );
}
function turned(profile: number[][], segments = 32) {
  const g = new THREE.LatheGeometry(
    profile.map(([r, z]) => new THREE.Vector2(r, z)),
    segments,
  );
  g.rotateX(Math.PI / 2);
  return g;
}
export function nacelleGeometry() {
  return turned([
    [0.91, -3.65],
    [1.16, -3.1],
    [1.5, -1.4],
    [1.74, 1.8],
    [1.7, 2.7],
    [1.62, 3.2],
  ]);
}
export function intakeLipGeometry() {
  return turned([
    [1.7, 2.7],
    [1.67, 3],
    [1.62, 3.2],
    [1.53, 3.28],
    [1.43, 3.19],
    [1.4, 3.02],
    [1.41, 2.77],
  ]);
}
export function intakeGeometry() {
  return turned([
    [1.41, 2.79],
    [1.35, 2.3],
    [1.27, 1.55],
    [0, 1.53],
  ]);
}
export function exhaustGeometry() {
  return turned([
    [0.05, -4.4],
    [0.23, -4.35],
    [0.66, -3.85],
    [0.85, -3.62],
    [0.8, -3.45],
    [0, -3.45],
  ]);
}
export function spinnerGeometry() {
  return turned(
    [
      [0.42, 1.55],
      [0.4, 1.75],
      [0.25, 2.07],
      [0.02, 2.3],
    ],
    20,
  );
}
export function cockpitGeometry() {
  const vertices: number[] = [],
    indices: number[] = [],
    angles = [0.53, 1.08, 1.57, 2.06, 2.61];
  for (let i = 0; i < angles.length - 1; i++) {
    const a = angles[i] + 0.025,
      b = angles[i + 1] - 0.025,
      start = vertices.length / 3;
    for (const z of [28.8, 30.65])
      for (let j = 0; j <= 4; j++)
        vertices.push(
          ...bodySurface(z, a + ((b - a) * j) / 4, 0.035).toArray(),
        );
    for (let j = 0; j < 4; j++)
      indices.push(
        start + j,
        start + j + 5,
        start + j + 1,
        start + j + 1,
        start + j + 5,
        start + j + 6,
      );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
