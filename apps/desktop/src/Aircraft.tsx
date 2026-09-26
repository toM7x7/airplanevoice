import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  DEFAULT_AIRCRAFT,
  type AircraftDesign,
} from "../../../packages/core/src";
import {
  bodySurface,
  cockpitGeometry,
  exhaustGeometry,
  fuselageGeometry,
  intakeGeometry,
  intakeLipGeometry,
  nacelleGeometry,
  spinnerGeometry,
  wingGeometry,
} from "./aircraft-geometry";

export function Aircraft({
  accent = "#205963",
  design = DEFAULT_AIRCRAFT,
}: {
  accent?: string;
  design?: AircraftDesign;
}) {
  const root = useRef<THREE.Group>(null);
  const details = useRef<THREE.Group>(null);
  const windows = useRef<THREE.InstancedMesh>(null);
  const engineParts = useRef<(THREE.InstancedMesh | null)[]>([]);
  const positions = useMemo(
    () => ({ plane: new THREE.Vector3(), eye: new THREE.Vector3() }),
    [],
  );
  const shape = useMemo(
    () => ({
      body: fuselageGeometry(),
      left: wingGeometry(-1, "main", design.wingSweepDeg),
      right: wingGeometry(1, "main", design.wingSweepDeg),
      tailLeft: wingGeometry(-1, "tail"),
      tailRight: wingGeometry(1, "tail"),
      fin: wingGeometry(1, "fin"),
      nacelle: nacelleGeometry(),
      lip: intakeLipGeometry(),
      intake: intakeGeometry(),
      exhaust: exhaustGeometry(),
      spinner: spinnerGeometry(),
      cockpit: cockpitGeometry(),
      window: new THREE.SphereGeometry(1, 8, 6),
      fairing: new THREE.SphereGeometry(1, 24, 12),
      pylon: new THREE.BoxGeometry(0.48, 1, 1),
      light: new THREE.SphereGeometry(0.25, 8, 6),
    }),
    [design.wingSweepDeg],
  );
  const materials = useMemo(
    () => ({
      paint: new THREE.MeshStandardMaterial({
        color: "#eceeea",
        roughness: 0.3,
        metalness: 0,
        vertexColors: true,
      }),
      shell: new THREE.MeshStandardMaterial({
        color: "#e5e9e8",
        roughness: 0.3,
        metalness: 0,
      }),
      wing: new THREE.MeshStandardMaterial({
        color: "#c7d1d6",
        roughness: 0.35,
        metalness: 0.18,
      }),
      lip: new THREE.MeshStandardMaterial({
        color: "#bdc8cf",
        roughness: 0.26,
        metalness: 0.88,
      }),
      dark: new THREE.MeshStandardMaterial({
        color: "#17212a",
        roughness: 0.8,
        metalness: 0.1,
      }),
      exhaust: new THREE.MeshStandardMaterial({
        color: "#59636b",
        roughness: 0.48,
        metalness: 0.75,
      }),
      glass: new THREE.MeshStandardMaterial({
        color: "#183342",
        roughness: 0.24,
        metalness: 0.22,
        side: THREE.DoubleSide,
      }),
      tail: new THREE.MeshStandardMaterial({ roughness: 0.33 }),
      windows: new THREE.MeshStandardMaterial({
        color: "#24404d",
        roughness: 0.55,
        metalness: 0,
        envMapIntensity: 0.15,
        transparent: true,
        depthWrite: false,
      }),
      red: new THREE.MeshBasicMaterial({ color: "#cb5550" }),
      green: new THREE.MeshBasicMaterial({ color: "#73b897" }),
    }),
    [],
  );
  useLayoutEffect(() => {
    materials.tail.color.set(design.color ?? accent);
    materials.paint.color.set(design.bodyColor ?? "#eceeea");
    materials.shell.color.set(design.bodyColor ?? "#e5e9e8");
  }, [materials, accent, design.color, design.bodyColor]);
  useLayoutEffect(() => {
    const instances = [windows.current, ...engineParts.current];
    return () => instances.forEach((mesh) => mesh?.dispose());
  }, []);
  // This instance owns the reusable geometry/materials. Edits only transform them.
  useEffect(
    () => () => {
      Object.values(shape).forEach((g) => g.dispose());
    },
    [shape],
  );
  useEffect(()=>()=>Object.values(materials).forEach(m=>m.dispose()),[materials]);
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    [-1, 1].forEach((side, j) => {
      for (let i = 0; i < 26; i++) {
        const angle = side === 1 ? 0.32 : Math.PI - 0.32;
        dummy.position.copy(bodySurface(-18 + i * 1.65, angle, 0.035));
        dummy.rotation.set(0, 0, side * 0.32);
        dummy.scale.set(0.045, 0.36, 0.245);
        dummy.updateMatrix();
        windows.current!.setMatrixAt(j * 26 + i, dummy.matrix);
      }
    });
    windows.current!.instanceMatrix.needsUpdate = true;
    windows.current!.computeBoundingSphere();
  }, [shape.window]);
  useFrame(({ camera, gl }) => {
    if (!root.current || !details.current) return;
    root.current.getWorldPosition(positions.plane);
    camera.getWorldPosition(positions.eye);
    const fovScale =
      !gl.xr.isPresenting && camera instanceof THREE.PerspectiveCamera
        ? Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) /
          Math.tan(THREE.MathUtils.degToRad(29))
        : 1;
    const distance = positions.plane.distanceTo(positions.eye) * fovScale;
    // Fade subpixel windows; solid intakes and cockpit retain their silhouette.
    const fade = 1 - THREE.MathUtils.smoothstep(distance, 700, 1500);
    materials.windows.opacity = fade;
    details.current.visible = fade > 0.001;
  });
  const lengthScale = design.bodyLengthM / 71,
    spanScale = design.wingSpanM / 64;
  const engineScale = (design.engineCount === 2 ? 1.17 : 1)*(design.engineScale??1);
  const bodyScale=(design.bodyWidthM??6.2)/6.2;
  const sweepDelta=Math.tan((design.wingSweepDeg??30)*Math.PI/180)-Math.tan(Math.PI/6);
  useLayoutEffect(() => {
    const engines = [-1, 1].flatMap((side) =>
      (design.engineCount === 4 ? [13, 23] : [16]).map((x) => ({
        x: side * x * spanScale,
        z: 1.5 - (x - 12) * 0.61 - 2 - (x-4)*sweepDelta,
        wingY: -0.1 + (x - 12) * 0.085,
      })),
    );
    const dummy = new THREE.Object3D();
    engineParts.current.forEach((mesh, part) => {
      if (!mesh) return;
      engines.forEach((engine, i) => {
        if (part === 0) {
          dummy.position.set(engine.x, engine.wingY - 0.9, engine.z - 1.2);
          dummy.scale.set(1, 1.8, 3.5);
        } else {
          dummy.position.set(
            engine.x,
            engine.wingY - 2.6 * engineScale,
            engine.z,
          );
          dummy.scale.setScalar(engineScale);
        }
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.count = engines.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [design.engineCount, spanScale, engineScale,sweepDelta]);
  return (
    <group ref={root} scale={[1, 1, lengthScale]} dispose={null}>
      <mesh geometry={shape.body} material={materials.paint} scale={[bodyScale,bodyScale,1]} />
      <mesh
        geometry={shape.fairing}
        material={materials.shell}
        position={[0, -2.5, -3.5]}
        scale={[3.2, 1.15, 10]}
      />
      <group scale={[spanScale, 1, 1]}>
        {[shape.left, shape.right, shape.tailLeft, shape.tailRight].map(
          (g, i) => (
            <mesh key={i} geometry={g} material={materials.wing} />
          ),
        )}
      </group>
      <mesh geometry={shape.fin} material={materials.tail} />
      <mesh geometry={shape.cockpit} material={materials.glass} scale={[bodyScale,bodyScale,1]} />
      {(
        [
          [shape.pylon, materials.wing],
          [shape.nacelle, materials.shell],
          [shape.lip, materials.lip],
          [shape.intake, materials.dark],
          [shape.exhaust, materials.exhaust],
          [shape.spinner, materials.exhaust],
        ] as const
      ).map(([geometry, material], i) => (
        <instancedMesh
          key={i}
          args={[geometry, material, 4]}
          ref={(mesh) => {
            engineParts.current[i] = mesh;
          }}
        />
      ))}
      <group ref={details} scale={[bodyScale,bodyScale,1]}>
        <instancedMesh
          ref={windows}
          args={[shape.window, materials.windows, 52]}
        />
      </group>
      {[-1, 1].map((side) => (
        <group key={side}>
        {(design.wingletHeightM??0)>0 && <mesh material={materials.tail} position={[side*31.4*spanScale,2.53+(design.wingletHeightM??0)/2,-11.8-27.4*sweepDelta]} rotation={[.2,0,-side*.2]}><boxGeometry args={[.16,design.wingletHeightM,1.65]}/></mesh>}
        <mesh
          key={side}
          geometry={shape.light}
          material={side < 0 ? materials.red : materials.green}
          position={[side * 31.6 * spanScale, 2.53, -11.8-27.6*sweepDelta]}
        />
        </group>
      ))}
    </group>
  );
}
