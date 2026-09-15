import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import {
  AIRCRAFT,
  Experience,
  clamp,
  type FlightId,
  type TrailPoint,
} from "../../../packages/core/src";
import { Aircraft } from "./Aircraft";
import type { AircraftAudio } from "./audio";
import type { VrRuntime } from "./vr";
import { TrailVisibility } from "./trail-visibility";

export interface ViewState {
  yaw: number;
  pitch: number;
  zoom: boolean;
}
export interface AircraftTarget {
  id: FlightId;
  x: number;
  y: number;
  radius: number;
  distance: number;
}
interface SceneProps {
  experience: Experience;
  audio: AircraftAudio;
  vr: VrRuntime;
  soundOn: boolean;
  view: MutableRefObject<ViewState>;
  manual: MutableRefObject<boolean>;
  reduced: boolean;
  selectedId: FlightId | null;
  onSelect: (id: FlightId) => void;
}
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

function Sky() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader:
          "varying vec3 vPosition; void main(){vPosition=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
        fragmentShader: `varying vec3 vPosition;
      void main() {
        vec3 d = normalize(vPosition);
        float h = max(0.0,d.y);
        vec3 color = mix(vec3(0.59,0.75,0.79),vec3(0.035,0.23,0.46),pow(h,0.38));
        float sun = pow(max(0.0,dot(d,normalize(vec3(-0.7,0.7,-1.0)))),100.0);
        color += vec3(0.18,0.15,0.08)*sun;
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material}>
      <sphereGeometry args={[18000, 24, 16]} />
    </mesh>
  );
}

function Landscape() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.2, 0]}>
        <planeGeometry args={[28000, 28000]} />
        <meshStandardMaterial color="#778b75" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-2200, -0.05, -7000]}>
        <planeGeometry args={[11000, 3800]} />
        <meshStandardMaterial color="#8baaaa" roughness={0.75} />
      </mesh>
      {[-1, 1].flatMap((side) =>
        Array.from({ length: 9 }, (_, i) => (
          <group
            key={`${side}-${i}`}
            position={[side * (48 + i * 27), 0, -125 - i * 53]}
          >
            <mesh position={[0, 2.4, 0]}>
              <cylinderGeometry args={[0.35, 0.55, 4.8, 6]} />
              <meshStandardMaterial color="#60694f" />
            </mesh>
            <mesh position={[0, 5.7, 0]} scale={[3, 4.1, 2.8]}>
              <icosahedronGeometry args={[1, 1]} />
              <meshStandardMaterial
                color={i % 2 ? "#617e63" : "#52755e"}
                flatShading
              />
            </mesh>
          </group>
        )),
      )}
      {Array.from({ length: 8 }, (_, i) => (
        <mesh
          key={i}
          position={[-6600 + i * 1900, -160, -12500]}
          scale={[2200, 550 + (i % 3) * 130, 900]}
        >
          <sphereGeometry args={[1, 16, 8]} />
          <meshBasicMaterial color="#9eb7b3" />
        </mesh>
      ))}
    </group>
  );
}

function World({
  experience: e,
  audio,
  vr,
  soundOn,
  view,
  manual,
  reduced,
  selectedId,
  targets,
  marker,
}: SceneProps & {
  targets: MutableRefObject<AircraftTarget[]>;
  marker: MutableRefObject<HTMLDivElement | null>;
}) {
  const aircraft = useRef<(THREE.Group | null)[]>([]);
  const design = useRef<THREE.LineLoop>(null);
  const trail = useRef<THREE.LineSegments>(null);
  const rings = useRef<THREE.InstancedMesh>(null);
  const { camera, gl, size, scene } = useThree();
  useEffect(() => vr.attach(gl, camera, scene), [vr, gl, camera, scene]);
  const geometry = useMemo(() => new THREE.BufferGeometry(), []);
  const trailVisibility = useMemo(() => new TrailVisibility(), []);
  const trailGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(384 * 2 * 3), 3),
    );
    g.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(384 * 2 * 3), 3),
    );
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const designMaterial = useMemo(
    () =>
      new THREE.LineDashedMaterial({
        color: "#e8efdf",
        transparent: true,
        opacity: 0.5,
        dashSize: 18,
        gapSize: 14,
      }),
    [],
  );
  const trailMaterial = useMemo(
    () =>
      trailVisibility.apply(
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        }),
      ),
    [trailVisibility],
  );
  const ringMaterial = useMemo(
    () =>
      trailVisibility.apply(
        new THREE.MeshBasicMaterial({
          color: "#d9f6f7",
          transparent: true,
          opacity: 0.17,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      ),
    [trailVisibility],
  );
  const lineObject = useMemo(
    () => new THREE.LineLoop(geometry, designMaterial),
    [geometry, designMaterial],
  );
  const trailObject = useMemo(
    () => new THREE.LineSegments(trailGeometry, trailMaterial),
    [trailGeometry, trailMaterial],
  );
  const temp = useMemo(
    () => ({
      tangent: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      projected: new THREE.Vector3(),
      matrix: new THREE.Matrix4(),
      bank: new THREE.Quaternion(),
      dummy: new THREE.Object3D(),
    }),
    [],
  );
  const checksum = useRef("");
  useEffect(
    () => () => {
      geometry.dispose();
      trailGeometry.dispose();
      designMaterial.dispose();
      trailMaterial.dispose();
      ringMaterial.dispose();
    },
    [geometry, trailGeometry, designMaterial, trailMaterial, ringMaterial],
  );
  useFrame((_, dt, frame) => {
    const immersive = vr.update(frame, dt);
    const v = view.current;
    if (!immersive) {
      camera.position.set(e.listener.x, e.listener.y, e.listener.z);
      camera.rotation.set(v.pitch, v.yaw, 0, "YXZ");
      if (
        camera instanceof THREE.PerspectiveCamera &&
        camera.fov !== (v.zoom ? 30 : 58)
      ) {
        camera.fov = v.zoom ? 30 : 58;
        camera.updateProjectionMatrix();
      }
      camera.getWorldDirection(temp.forward);
      temp.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      audio.setListener(e.listener, temp.forward, temp.up);
    }
    if (!manual.current && vr.canAdvance) e.advance(Math.min(dt * 1000, 250));
    vr.draw(selectedId, soundOn);
    const visibleTargets: AircraftTarget[] = [];
    aircraft.current.forEach((mesh, index) => {
      const clearance = trailVisibility.aircraft.value[index];
      clearance.set(0, 0, 0, 0);
      if (!mesh) return;
      const f = e.flights[index];
      mesh.visible =
        e.phase === "EDIT" ? index === 0 : !!f && f.started && !f.ended;
      if (!mesh.visible) return;
      const pose = e.pose(AIRCRAFT[index].id);
      mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
      clearance.set(
        mesh.position.x,
        mesh.position.y,
        mesh.position.z,
        Math.max(e.aircraftDesign.bodyLengthM, e.aircraftDesign.wingSpanM) *
          0.6,
      );
      temp.tangent.set(pose.tangent.x, pose.tangent.y, pose.tangent.z);
      temp.right.crossVectors(UP, temp.tangent).normalize();
      temp.up.crossVectors(temp.tangent, temp.right).normalize();
      temp.matrix.makeBasis(temp.right, temp.up, temp.tangent);
      // Positive core bank means turning right; local +Z forward needs negative roll.
      mesh.quaternion
        .setFromRotationMatrix(temp.matrix)
        .multiply(temp.bank.setFromAxisAngle(Z, -pose.bankRad));
      temp.projected.copy(mesh.position).project(camera);
      const p = temp.projected;
      if (
        !immersive &&
        Math.abs(p.x) <= 1 &&
        Math.abs(p.y) <= 1 &&
        p.z >= -1 &&
        p.z <= 1
      ) {
        const distance = mesh.position.distanceTo(camera.position);
        const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 58;
        visibleTargets.push({
          id: AIRCRAFT[index].id,
          x: ((p.x + 1) * size.width) / 2,
          y: ((1 - p.y) * size.height) / 2,
          radius: clamp(
            (Math.max(
              e.aircraftDesign.bodyLengthM,
              e.aircraftDesign.wingSpanM,
            ) *
              size.height) /
              (4 * Math.tan((fov * Math.PI) / 360) * distance),
            16,
            80,
          ),
          distance,
        });
      }
    });
    targets.current = visibleTargets;
    window.__soundTrailTargets = visibleTargets;
    if (marker.current) {
      const selected = visibleTargets.find((t) => t.id === selectedId);
      marker.current.style.visibility =
        selected && !e.paused ? "visible" : "hidden";
      if (selected) {
        marker.current.style.left = `${selected.x}px`;
        marker.current.style.top = `${selected.y}px`;
        marker.current.style.width = `${selected.radius * 2 + 10}px`;
        marker.current.style.height = `${selected.radius * 2 + 10}px`;
      }
    }
    if (checksum.current !== e.route.checksum) {
      geometry.setFromPoints(
        e.route.samples.map(
          (s) => new THREE.Vector3(s.position.x, s.position.y, s.position.z),
        ),
      );
      lineObject.computeLineDistances();
      checksum.current = e.route.checksum;
    }
    if (design.current) design.current.visible = e.phase === "EDIT";
    const position = trailGeometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const color = trailGeometry.getAttribute("color") as THREE.BufferAttribute;
    let count = 0;
    const previous = new Map<FlightId, TrailPoint>();
    for (const b of e.trails) {
      const a = previous.get(b.flightId);
      previous.set(b.flightId, b);
      // Arrival order may differ from emission order. Never connect distant samples.
      if (!a || Math.abs(a.emissionId - b.emissionId) !== 1) continue;
      const fade = Math.pow(
        Math.max(
          0,
          1 - (e.nowMs - b.arrivalAtMs) / (e.recipe.trailPersistenceSec * 1000),
        ),
        0.7,
      );
      position.setXYZ(count, a.position.x, a.position.y, a.position.z);
      position.setXYZ(count + 1, b.position.x, b.position.y, b.position.z);
      color.setXYZ(count, fade * 0.72, fade * 0.95, fade);
      color.setXYZ(count + 1, fade * 0.72, fade * 0.95, fade);
      count += 2;
    }
    trailGeometry.setDrawRange(0, count);
    position.needsUpdate = true;
    color.needsUpdate = true;
    trailObject.frustumCulled = false;
    trailMaterial.opacity = reduced ? 0.18 : 0.55;
    if (rings.current) {
      const recent = e.trails
        .filter((p) => p.emissionId % 8 === 0 && e.nowMs - p.arrivalAtMs < 1800)
        .slice(-8);
      rings.current.count = reduced ? 0 : recent.length;
      recent.forEach((p, i) => {
        const age = (e.nowMs - p.arrivalAtMs) / 1800;
        temp.dummy.position.set(p.position.x, p.position.y, p.position.z);
        temp.dummy.quaternion.copy(camera.quaternion);
        temp.dummy.scale.setScalar(10 + age * 28);
        temp.dummy.updateMatrix();
        rings.current!.setMatrixAt(i, temp.dummy.matrix);
        rings.current!.setColorAt(
          i,
          new THREE.Color().setRGB(0.55 + age * 0.05, 0.8, 0.9),
        );
      });
      rings.current.instanceMatrix.needsUpdate = true;
      if (rings.current.instanceColor)
        rings.current.instanceColor.needsUpdate = true;
    }
    window.__soundTrailRender = {
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
    };
  });
  return (
    <>
      <Sky />
      <fog attach="fog" args={["#b9d0cd", 3000, 18000]} />
      <hemisphereLight args={["#ebf5ff", "#667a60", 2.2]} />
      <directionalLight
        position={[-1500, 3500, 1800]}
        intensity={3}
        color="#fff3d7"
      />
      <Landscape />
      {AIRCRAFT.map((a, index) => (
        <group
          key={a.id}
          ref={(mesh) => {
            aircraft.current[index] = mesh;
          }}
        >
          <Aircraft accent={a.accent} design={e.aircraftDesign} />
        </group>
      ))}
      <primitive object={lineObject} ref={design} />
      <primitive object={trailObject} ref={trail} />
      <instancedMesh
        ref={rings}
        args={[undefined, undefined, 8]}
        frustumCulled={false}
        material={ringMaterial}
      >
        <ringGeometry args={[0.94, 1, 48]} />
      </instancedMesh>
    </>
  );
}

export function Scene(props: SceneProps) {
  const drag = useRef<{
    x: number;
    y: number;
    startX: number;
    startY: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);
  const targets = useRef<AircraftTarget[]>([]);
  const marker = useRef<HTMLDivElement>(null);
  function pick(x: number, y: number, touch: boolean) {
    return targets.current
      .filter(
        (t) =>
          Math.hypot(t.x - x, t.y - y) <= Math.max(t.radius, touch ? 22 : 16),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) ||
          a.distance - b.distance,
      )[0]?.id;
  }
  return (
    <div
      className="world"
      aria-label="飛行観察の3D画面。ドラッグで見回し、機体を押すと情報が開きます。"
      onPointerDown={(event) => {
        if (props.vr.active) return;
        if (
          event.target instanceof HTMLCanvasElement &&
          event.button === 0 &&
          event.isPrimary &&
          !drag.current
        ) {
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
            pointerId: event.pointerId,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d) {
          const rect = event.currentTarget.getBoundingClientRect();
          event.currentTarget.style.cursor = pick(
            event.clientX - rect.left,
            event.clientY - rect.top,
            event.pointerType === "touch",
          )
            ? "pointer"
            : "grab";
          return;
        }
        if (event.pointerId !== d.pointerId) return;
        if (Math.hypot(event.clientX - d.startX, event.clientY - d.startY) > 6)
          d.moved = true;
        if (d.moved) {
          event.currentTarget.style.cursor = "grabbing";
          props.view.current.yaw += (event.clientX - d.x) * 0.003;
          props.view.current.pitch = clamp(
            props.view.current.pitch + (event.clientY - d.y) * 0.003,
            -0.12,
            1.45,
          );
        }
        d.x = event.clientX;
        d.y = event.clientY;
      }}
      onPointerUp={(event) => {
        const d = drag.current;
        if (!d || d.pointerId !== event.pointerId) return;
        if (
          !d.moved &&
          Math.hypot(event.clientX - d.startX, event.clientY - d.startY) <= 6
        ) {
          const rect = event.currentTarget.getBoundingClientRect();
          const id = pick(
            event.clientX - rect.left,
            event.clientY - rect.top,
            event.pointerType === "touch",
          );
          if (id) props.onSelect(id);
        }
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        event.currentTarget.style.cursor = "grab";
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    >
      <Canvas
        dpr={[1, 1.6]}
        camera={{ fov: 58, near: 0.1, far: 24000 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        fallback={
          <div className="webgl-fallback">
            3D表示を開始できません。WebGLが使えるブラウザで開いてください。
          </div>
        }
      >
        <World {...props} targets={targets} marker={marker} />
      </Canvas>
      <div ref={marker} className="aircraft-marker" aria-hidden="true">
        <span>{props.selectedId}</span>
      </div>
    </div>
  );
}
