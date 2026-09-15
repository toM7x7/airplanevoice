import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  DEFAULT_AIRCRAFT,
  type AircraftDesign,
} from "../../../packages/core/src";

function wingGeometry(side: number, tail = false) {
  const shape = new THREE.Shape();
  const pts = tail
    ? [
        [2, -22],
        [14, -29],
        [13, -31],
        [2, -29],
      ]
    : [
        [2.5, 6],
        [31, -9],
        [32, -13],
        [9, -9],
        [2.5, -12],
      ];
  pts.forEach(([x, z], i) =>
    i === 0 ? shape.moveTo(x * side, z) : shape.lineTo(x * side, z),
  );
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: tail ? 0.45 : 0.75,
    bevelEnabled: false,
  });
  g.rotateX(Math.PI / 2);
  return g;
}
export function Aircraft({
  accent = "#205963",
  design = DEFAULT_AIRCRAFT,
}: {
  accent?: string;
  design?: AircraftDesign;
}) {
  const details = useRef<THREE.Group>(null);
  const windows = useRef<THREE.InstancedMesh>(null);
  const worldPosition = useMemo(() => new THREE.Vector3(), []);
  const lengthScale = design.bodyLengthM / 71,
    spanScale = design.wingSpanM / 64;
  const engines = [-1, 1].flatMap((side) =>
    (design.engineCount === 4 ? [13, 23] : [16]).map((x, i) => ({
      x: side * x * spanScale,
      z: -i * 5,
    })),
  );
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    [-1, 1].forEach((side, j) => {
      for (let i = 0; i < 26; i++) {
        dummy.position.set(side * 3.18, 1.2, -18 + i * 1.65);
        dummy.scale.set(0.1, 0.42, 0.3);
        dummy.updateMatrix();
        windows.current!.setMatrixAt(j * 26 + i, dummy.matrix);
      }
    });
    windows.current!.instanceMatrix.needsUpdate = true;
    windows.current!.computeBoundingSphere();
  }, []);
  useFrame(({ camera }) => {
    if (!details.current) return;
    details.current.getWorldPosition(worldPosition);
    const scale =
      camera instanceof THREE.PerspectiveCamera
        ? Math.tan((camera.fov * Math.PI) / 360) /
          Math.tan((29 * Math.PI) / 180)
        : 1;
    const effectiveDistance = worldPosition.distanceTo(camera.position) * scale;
    details.current.visible =
      effectiveDistance < (details.current.visible ? 1700 : 1450);
  });
  const body = useMemo(
    () =>
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.25, -35),
          new THREE.Vector2(1.3, -31),
          new THREE.Vector2(2.8, -20),
          new THREE.Vector2(3.25, -9),
          new THREE.Vector2(3.3, 20),
          new THREE.Vector2(2.8, 28),
          new THREE.Vector2(1.8, 33),
          new THREE.Vector2(0.1, 36),
        ],
        24,
      ),
    [],
  );
  const wings = useMemo(
    () => [
      wingGeometry(-1),
      wingGeometry(1),
      wingGeometry(-1, true),
      wingGeometry(1, true),
    ],
    [],
  );
  const fin = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.2, -32);
    shape.lineTo(0, -20);
    shape.lineTo(11, -31);
    shape.lineTo(11, -35);
    shape.lineTo(0, -34);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.65,
      bevelEnabled: false,
    });
    g.rotateY(Math.PI / 2);
    g.rotateX(Math.PI / 2);
    return g;
  }, []);
  return (
    <group scale={[1, 1, lengthScale]}>
      <mesh geometry={body} rotation={[Math.PI / 2, 0, 0]}>
        <meshStandardMaterial
          color="#e8e6dc"
          roughness={0.55}
          metalness={0.15}
        />
      </mesh>
      <mesh position={[0, 2.1, 17]} scale={[2.85, 1.8, 10]}>
        <sphereGeometry args={[1, 20, 12]} />
        <meshStandardMaterial color="#e5e4dd" />
      </mesh>
      <group scale={[spanScale, 1, 1]}>
        {wings.map((g, i) => (
          <mesh key={i} geometry={g} position={[0, i < 2 ? -0.9 : 0.7, 0]}>
            <meshStandardMaterial
              color={i < 2 ? "#c4cdd0" : "#d2dbdc"}
              metalness={0.3}
              roughness={0.45}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
      </group>
      <mesh geometry={fin} position={[0, 1.5, 0]}>
        <meshStandardMaterial color={accent} side={THREE.DoubleSide} />
      </mesh>
      {engines.map((engine, i) => (
        <group key={i} position={[engine.x, -3.6, engine.z]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[1.5, 1.15, 7, 20]} />
            <meshStandardMaterial
              color="#d4d9d8"
              metalness={0.4}
              roughness={0.4}
            />
          </mesh>
          <mesh position={[0, 1.8, -0.5]}>
            <boxGeometry args={[0.55, 2.8, 3.3]} />
            <meshStandardMaterial color="#ccd4d3" />
          </mesh>
        </group>
      ))}
      <group ref={details}>
        {engines.map((engine, i) => (
          <group key={i} position={[engine.x, -3.6, engine.z]}>
            <mesh position={[0, 0, 3.52]}>
              <circleGeometry args={[1.26, 20]} />
              <meshStandardMaterial color="#25353d" side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, 0, 3.58]}>
              <sphereGeometry args={[0.43, 12, 8]} />
              <meshStandardMaterial color="#7c888c" />
            </mesh>
          </group>
        ))}
        <instancedMesh ref={windows} args={[undefined, undefined, 52]}>
          <sphereGeometry args={[1, 6, 4]} />
          <meshBasicMaterial color="#36535f" />
        </instancedMesh>
        <mesh position={[0, 3.2, 27.1]} scale={[2.2, 0.6, 1.35]}>
          <sphereGeometry args={[1, 16, 8]} />
          <meshStandardMaterial color="#234553" />
        </mesh>
      </group>
      {[-1, 1].map((side) => (
        <mesh
          key={`light-${side}`}
          position={[side * 31 * spanScale, -0.7, -11]}
        >
          <sphereGeometry args={[0.45, 8, 6]} />
          <meshBasicMaterial color={side < 0 ? "#e36c58" : "#9dd8bd"} />
        </mesh>
      ))}
    </group>
  );
}
