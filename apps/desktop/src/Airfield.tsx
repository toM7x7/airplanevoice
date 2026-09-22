import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Aircraft } from "./Aircraft";
import type { AircraftDesign } from "../../../packages/core/src/workshop";
import { nearModel, SpatialGrab } from "./ui/spatial-grab";

/** A deliberately small number of meshes; dimensions are world metres. */
export function Airfield() {
  return (
    <group name="airfield">
      <mesh position={[0, 0.02, -180]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3000, 60]} />
        <meshStandardMaterial color="#54656a" roughness={0.95} />
      </mesh>
      {Array.from({ length: 25 }, (_, i) => (
        <mesh
          key={i}
          position={[(i - 12) * 115, 0.04, -180]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[45, 1.5]} />
          <meshBasicMaterial color="#ece7d7" />
        </mesh>
      ))}
      <mesh position={[-120, 0.03, -270]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[280, 125]} />
        <meshStandardMaterial color="#a1a99f" />
      </mesh>
      <group position={[-120, 0, -360]} rotation={[0, Math.PI, 0]}>
        <mesh position={[-53, 18, 0]}>
          <boxGeometry args={[4, 36, 78]} />
          <meshStandardMaterial color="#b6c4be" />
        </mesh>
        <mesh position={[53, 18, 0]}>
          <boxGeometry args={[4, 36, 78]} />
          <meshStandardMaterial color="#b6c4be" />
        </mesh>
        <mesh position={[0, 18, 38]}>
          <boxGeometry args={[110, 36, 3]} />
          <meshStandardMaterial color="#8faba4" />
        </mesh>
        <mesh position={[0, 37, 0]}>
          <boxGeometry args={[116, 3, 84]} />
          <meshStandardMaterial color="#315756" />
        </mesh>
      </group>
    </group>
  );
}
export function CreationModel({
  design,
  placement,
  vr,
  desktop = false,
  offset = 0,
}: {
  design: AircraftDesign;
  placement: string;
  vr: import("./vr").VrRuntime;
  desktop?: boolean;
  offset?: number;
}) {
  const root = useRef<THREE.Group>(null),
    model = useRef<THREE.Group>(null);
  const { camera, gl } = useThree();
  const pending = useRef(2),
    anchorVersion = useRef(-1);
  const held = useRef<THREE.Group | null>(null);
  const grab = useMemo(() => new SpatialGrab(), []);
  const nearby = useRef(false);
  const halo = useRef<THREE.Mesh>(null);
  const size = useRef(1);
  const baseScale = desktop ? 0.035 : 0.006;
  const mouse = useRef<{ id: number; x: number; y: number } | null>(null);
  const tmp = useMemo(
    () => ({
      p: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      f: new THREE.Vector3(),
      offset: new THREE.Vector3(),
      startQ: new THREE.Quaternion(),
      baseQ: new THREE.Quaternion(),
      delta: new THREE.Quaternion(),
      raycaster: new THREE.Raycaster(),
      hit: new THREE.Vector3(),
      box: new THREE.Box3(),
    }),
    [],
  );
  useEffect(() => {
    pending.current = 2;
    held.current = null;
    grab.end();
    size.current = 1;
    model.current?.scale.setScalar(baseScale);
  }, [placement, baseScale, offset]);
  useEffect(() => {
    const api = {
      inspect: () => ({
        position: root.current?.position.toArray(),
        orientation: root.current?.quaternion.toArray(),
        rotation: model.current?.rotation.toArray(),
        scale: size.current,
        held: !!held.current,
        color: design.color ?? "#205963",
        bounds: model.current
          ? {
              min: new THREE.Box3().setFromObject(model.current).min.toArray(),
              max: new THREE.Box3().setFromObject(model.current).max.toArray(),
            }
          : undefined,
      }),
      near: (point: THREE.Vector3) => {
        nearby.current =
          !!root.current?.visible &&
          !!model.current &&
          nearModel(model.current, point);
        return nearby.current;
      },
      beginNear: (controller: THREE.Group, point: THREE.Vector3) => {
        if (
          !root.current?.visible ||
          !model.current ||
          held.current ||
          !nearModel(model.current, point)
        )
          return false;
        held.current = controller;
        return grab.begin(root.current, controller);
      },
      begin: (controller: THREE.Group, ray: THREE.Ray) => {
        if (!root.current?.visible || held.current) return false;
        root.current.updateWorldMatrix(true, true);
        tmp.raycaster.ray.copy(ray);
        if (
          !model.current ||
          (!tmp.raycaster.intersectObject(model.current, true).length &&
            !ray.intersectBox(
              tmp.box.setFromObject(model.current).expandByScalar(0.035),
              tmp.hit,
            ))
        )
          return false;
        held.current = controller;
        return grab.begin(root.current, controller);
      },
      end: (controller?: THREE.Group) => {
        if (!controller || held.current === controller) held.current = null;
        grab.end(controller);
      },
      command: (index: number) => {
        held.current = null;
        grab.end();
        if (index === 0 || index === 1)
          model.current?.rotateY(index === 0 ? 0.3 : -0.3);
        if (index === 2 || index === 3) {
          size.current = THREE.MathUtils.clamp(
            size.current * (index === 2 ? 1.15 : 1 / 1.15),
            0.65,
            1.5,
          );
          model.current?.scale.setScalar(baseScale * size.current);
        }
        if (index === 4) pending.current = 2;
        if (index === 5) {
          size.current = 1;
          model.current?.rotation.set(0, 0.7, 0);
          model.current?.scale.setScalar(baseScale);
          pending.current = 2;
        }
      },
    };
    vr.creationModel = api;
    return () => {
      held.current = null;
      grab.end();
      if (vr.creationModel === api) vr.creationModel = null;
    };
  }, [vr, tmp, design.color, baseScale]);
  useFrame(() => {
    if (!root.current) return;
    if (
      gl.xr.isPresenting &&
      anchorVersion.current !== vr.creationAnchorVersion
    ) {
      anchorVersion.current = vr.creationAnchorVersion;
      pending.current = 2;
      held.current = null;
      grab.end();
    }
    if (pending.current > 0 && --pending.current === 0) {
      camera.getWorldPosition(tmp.p);
      camera.getWorldQuaternion(tmp.q);
      tmp.f.set(0, 0, -1).applyQuaternion(tmp.q);
      if (gl.xr.isPresenting) root.current.position.copy(vr.creationAnchor);
      else if (desktop) root.current.position.set(offset * 4, 1.35, 0);
      else {
        root.current.position.copy(tmp.p).addScaledVector(tmp.f, 1.25);
        root.current.position.y += 0.08;
      }
      root.current.rotation.set(
        0,
        desktop ? 0 : Math.atan2(-tmp.f.x, -tmp.f.z),
        0,
      );
      root.current.visible = true;
    }
    if (halo.current) {
      halo.current.visible = !desktop && (nearby.current || !!held.current);
      nearby.current = false;
    }
    const controller = held.current;
    if (controller) {
      if (!controller.visible || !gl.xr.isPresenting) {
        held.current = null;
        grab.end();
        return;
      }
      grab.update();
    }
  });
  return (
    <group
      ref={root}
      visible={false}
      name="creation-model"
      onPointerOver={() => { if (!gl.xr.isPresenting) gl.domElement.style.cursor = mouse.current ? "grabbing" : "grab"; }}
      onPointerOut={() => { if (!mouse.current) gl.domElement.style.cursor = ""; }}
      onPointerDown={(event) => {
        if (gl.xr.isPresenting || event.button !== 0) return;
        event.stopPropagation();
        event.nativeEvent.stopPropagation();
        gl.domElement.style.cursor = "grabbing";
        mouse.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
        (
          event.target as unknown as { setPointerCapture: (id: number) => void }
        ).setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = mouse.current;
        if (!drag || drag.id !== event.pointerId) return;
        event.stopPropagation();
        event.nativeEvent.stopPropagation();
        if (model.current) {
          if (event.shiftKey && root.current) {
            const scale = desktop ? 0.006 : 0.001;
            root.current.position.x += (event.clientX - drag.x) * scale;
            root.current.position.y -= (event.clientY - drag.y) * scale;
          } else {
            model.current.rotation.y += (event.clientX - drag.x) * 0.012;
            model.current.rotation.x = THREE.MathUtils.clamp(
              model.current.rotation.x + (event.clientY - drag.y) * 0.008,
              -0.7,
              0.7,
            );
          }
        }
        mouse.current = { id: drag.id, x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        if (mouse.current?.id !== event.pointerId) return;
        event.stopPropagation();
        event.nativeEvent.stopPropagation();
        mouse.current = null;
        gl.domElement.style.cursor = "grab";
        (
          event.target as unknown as {
            releasePointerCapture: (id: number) => void;
          }
        ).releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        mouse.current = null;
      }}
    >
      <group ref={model} scale={baseScale} rotation={[0, 0.7, 0]}>
        <Aircraft design={design} />
        {desktop && (
          <mesh userData={{ grabOnly: true }}>
            <boxGeometry args={[design.wingSpanM, 12, design.bodyLengthM]} />
            <meshBasicMaterial
              transparent
              opacity={0}
              depthWrite={false}
              colorWrite={false}
            />
          </mesh>
        )}
      </group>
      <mesh
        ref={halo}
        visible={false}
        position={[0, -0.1, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <torusGeometry args={[0.25, 0.003, 8, 48]} />
        <meshStandardMaterial color="#d5ded8" roughness={0.5} />
      </mesh>
    </group>
  );
}

/** Local display set, separate from the full-size flight world. */
export function PreviewHangar() {
  return (
    <group name="preview-hangar">
      <mesh position={[0, 0.01, -1]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[20, 22]} />
        <meshStandardMaterial color="#d4d7cf" roughness={0.65} />
      </mesh>
      {[-5, 5].map((x) => (
        <group key={x}>
          <mesh position={[x, 2.8, -2]}>
            <boxGeometry args={[0.25, 5.6, 14]} />
            <meshStandardMaterial color="#a5b8b5" roughness={0.65} />
          </mesh>
          {[-7, -3, 1, 5].map((z) => (
            <mesh key={z} position={[x * 0.96, 2.8, z]}>
              <boxGeometry args={[0.2, 5.6, 0.2]} />
              <meshStandardMaterial color="#526f72" />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[0, 5.7, -2]}>
        <boxGeometry args={[10.5, 0.25, 14]} />
        <meshStandardMaterial color="#dce0d7" />
      </mesh>
      <mesh position={[0, 4.8, -8]}>
        <boxGeometry args={[10, 1.6, 0.3]} />
        <meshStandardMaterial color="#7a9492" />
      </mesh>
      {[-3, -1, 1, 3].map((x) => (
        <mesh key={x} position={[x, 0.025, -2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.025, 16]} />
          <meshBasicMaterial color="#a7b3ae" />
        </mesh>
      ))}
      <mesh position={[0, 0.028, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.1, 2.12, 64]} />
        <meshBasicMaterial color="#ac985e" />
      </mesh>
    </group>
  );
}

export function PreviewAirport() {
  return (
    <group name="preview-airport">
      <mesh position={[0, 0.01, -8]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[100, 80]} />
        <meshStandardMaterial color="#b7bfb9" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.03, -9]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[100, 5]} />
        <meshStandardMaterial color="#52636b" roughness={1} />
      </mesh>
      {Array.from({ length: 18 }, (_, i) => (
        <mesh
          key={i}
          position={[(i - 9) * 4, 0.04, -9]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[2, 0.12]} />
          <meshBasicMaterial color="#ede9d8" />
        </mesh>
      ))}
      {[-1.8, 1.8].map((x) => (
        <mesh key={x} position={[x, 0.04, -1]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.05, 9]} />
          <meshBasicMaterial color="#ac9251" />
        </mesh>
      ))}
      <group position={[-5, 0, -16]}>
        <mesh position={[0, 1.2, 0]}>
          <boxGeometry args={[12, 2.4, 3]} />
          <meshStandardMaterial color="#b9c8c6" />
        </mesh>
        <mesh position={[0, 1.45, 1.51]}>
          <planeGeometry args={[11, 1]} />
          <meshStandardMaterial
            color="#557d8a"
            metalness={0.15}
            roughness={0.25}
          />
        </mesh>
        <mesh position={[0, 2.5, 0]}>
          <boxGeometry args={[13, 0.2, 4]} />
          <meshStandardMaterial color="#647e80" />
        </mesh>
      </group>
      <group position={[5.5, 0, -17]}>
        <mesh position={[0, 2.7, 0]}>
          <cylinderGeometry args={[0.45, 0.65, 5.4, 8]} />
          <meshStandardMaterial color="#d3d8ce" />
        </mesh>
        <mesh position={[0, 5.4, 0]}>
          <cylinderGeometry args={[1.05, 0.75, 1, 8]} />
          <meshStandardMaterial
            color="#547e8a"
            metalness={0.15}
            roughness={0.25}
          />
        </mesh>
        <mesh position={[0, 6, 0]}>
          <cylinderGeometry args={[1.15, 1.15, 0.15, 8]} />
          <meshStandardMaterial color="#415f66" />
        </mesh>
      </group>
    </group>
  );
}
