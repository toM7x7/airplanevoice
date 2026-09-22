import {
  Airfield,
  CreationModel,
  PreviewHangar,
  PreviewAirport,
} from "./Airfield";
import type { AircraftDesign } from "../../../packages/core/src/workshop";
import {EnvironmentWorld} from "./EnvironmentWorld";
import {DEFAULT_ENVIRONMENT,type EnvironmentRecipe} from "../../../packages/core/src/environment";
import { soundPresence } from "../../../packages/core/src/sound-presence";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type MutableRefObject,
} from "react";
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
import { SkyEnvironment } from "./SkyEnvironment";
import { VenueWorld } from "./VenueWorld";
import { VenueOverview } from "./VenueOverview";
import type { VenueMap } from "../../../packages/core/src/venue";

export interface ViewState {
  free?: boolean;
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
  onClear: () => void;
  onFrame?: () => void;
  venue?: VenueMap;
  creationDesign?: AircraftDesign;
  airfield?: boolean;
  desktopPreview?: "hangar" | "airport" | "sky";
  previewOffset?: number;
  environment?: EnvironmentRecipe;
}
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

function Landscape({ airfield = false }: { airfield?: boolean }) {
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
            position={[
              side * (48 + i * 27),
              0,
              -(airfield ? 260 : 125) - i * 53,
            ]}
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
  onFrame,
  targets,
  marker,
  venue,
  creationDesign,
  airfield,
  desktopPreview,
  previewOffset = 0,
  environment = DEFAULT_ENVIRONMENT,
}: SceneProps & {
  targets: MutableRefObject<AircraftTarget[]>;
  marker: MutableRefObject<HTMLDivElement | null>;
}) {
  const aircraft = useRef<(THREE.Group | null)[]>([]);
  const design = useRef<THREE.LineLoop>(null);
  const trail = useRef<THREE.LineSegments>(null);
  const rings = useRef<THREE.InstancedMesh>(null);
  const soundBody = useRef<THREE.InstancedMesh>(null);
  const { camera, gl, size, scene } = useThree();
  const keys=useRef(new Set<string>());
  useEffect(()=>{
    const down=(event:KeyboardEvent)=>{if(!view.current.free||vr.active||(event.target as HTMLElement)?.closest("input,textarea,select,button,[contenteditable]"))return;
      const key=event.key.toLowerCase();if(["w","a","s","d","q","e","shift"].includes(key)){keys.current.add(key);event.preventDefault();}};
    const up=(event:KeyboardEvent)=>keys.current.delete(event.key.toLowerCase());
    const clear=()=>keys.current.clear();
    window.addEventListener("keydown",down);window.addEventListener("keyup",up);window.addEventListener("blur",clear);
    return()=>{window.removeEventListener("keydown",down);window.removeEventListener("keyup",up);window.removeEventListener("blur",clear);};
  },[view,vr]);
  const xr = useSyncExternalStore(vr.subscribe, () => vr.snapshot);
  const preview = xr.status !== "presenting" ? desktopPreview : undefined;
  const passthrough = xr.status === "presenting" && xr.displayMode === "ar";
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
      new THREE.BufferAttribute(new Float32Array(384 * 2 * 4), 4),
    );
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const ringGeometry = useMemo(() => {
    const g = new THREE.RingGeometry(0.94, 1, 48);
    g.setAttribute(
      "trailFade",
      new THREE.InstancedBufferAttribute(new Float32Array(8), 1),
    );
    return g;
  }, []);
  const bodyGeometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    g.setAttribute(
      "trailFade",
      new THREE.InstancedBufferAttribute(new Float32Array(384), 1),
    );
    return g;
  }, []);
  const bodyMaterial = useMemo(
    () =>
      trailVisibility.apply(
        new THREE.MeshBasicMaterial({
          color: "#c3e1db",
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
        }),
        true,
      ),
    [trailVisibility],
  );
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
          opacity: 0.08,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
        true,
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
      segment: new THREE.Vector3(),
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
      ringGeometry.dispose();
      bodyGeometry.dispose();
      bodyMaterial.dispose();
    },
    [
      geometry,
      trailGeometry,
      designMaterial,
      trailMaterial,
      ringMaterial,
      ringGeometry,
      bodyGeometry,
      bodyMaterial,
    ],
  );
  useFrame((_, dt, frame) => {
    const immersive = vr.update(frame, dt);
    const v = view.current;
    if (!immersive) {
      if(v.free&&!preview) {
        const forward=Number(keys.current.has("w"))-Number(keys.current.has("s")),right=Number(keys.current.has("d"))-Number(keys.current.has("a")),up=Number(keys.current.has("e"))-Number(keys.current.has("q"));
        if(forward||right||up) {const speed=(keys.current.has("shift")?150:40)*Math.min(dt,.1);e.trackListener({x:clamp(e.listener.x+(-Math.sin(v.yaw)*forward+Math.cos(v.yaw)*right)*speed,-3000,3000),y:clamp(e.listener.y+up*speed,1.7,700),z:clamp(e.listener.z+(-Math.cos(v.yaw)*forward-Math.sin(v.yaw)*right)*speed,-5000,1000)});}
      }
      camera.position.set(e.listener.x, e.listener.y, e.listener.z);
      camera.rotation.set(v.pitch, v.yaw, 0, "YXZ");
      if (preview) {
        camera.position.set(0, 2.5, size.width < 760 ? 5.8 : 4.8);
        camera.lookAt(0, 1.35, 0);
      }
      if (
        camera instanceof THREE.PerspectiveCamera &&
        camera.fov !== (preview ? 42 : v.zoom ? 30 : 58)
      ) {
        camera.fov = preview ? 42 : v.zoom ? 30 : 58;
        camera.updateProjectionMatrix();
      }
      camera.getWorldDirection(temp.forward);
      temp.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      audio.setListener(e.listener, temp.forward, temp.up);
    }
    if (onFrame) onFrame();
    else if (!manual.current && vr.canAdvance)
      e.advance(Math.min(dt * 1000, 250));
    vr.draw(selectedId, soundOn);
    const visibleTargets: AircraftTarget[] = [];
    aircraft.current.forEach((mesh, index) => {
      const clearance = trailVisibility.aircraft.value[index];
      clearance.set(0, 0, 0, 0);
      if (!mesh) return;
      const f = e.flights.find((f) => f.id === AIRCRAFT[index].id);
      mesh.visible =
        e.phase === "EDIT"
          ? creationDesign
            ? false
            : e.show
              ? e.flightIds.includes(AIRCRAFT[index].id)
              : index === 0
          : !!f && f.started && !f.ended;
      if (preview) mesh.visible = false;
      if (!mesh.visible) return;
      const pose = e.pose(AIRCRAFT[index].id);
      const aircraftDesign = e.designFor(AIRCRAFT[index].id);
      mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
      clearance.set(
        mesh.position.x,
        mesh.position.y,
        mesh.position.z,
        Math.max(aircraftDesign.bodyLengthM, aircraftDesign.wingSpanM) * 0.6,
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
            (Math.max(aircraftDesign.bodyLengthM, aircraftDesign.wingSpanM) *
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
    if (design.current)
      design.current.visible = e.phase === "EDIT" && !e.show && !creationDesign;
    const position = trailGeometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const color = trailGeometry.getAttribute("color") as THREE.BufferAttribute;
    let count = 0;
    let bodyCount = 0;
    const bodyFade = bodyGeometry.getAttribute("trailFade");
    const previous = new Map<FlightId, TrailPoint>();
    // Keep the most recent arrivals within the GPU buffer, including 12-aircraft skies.
    // Old arrivals are the first to disappear under load; never draw past allocated vertices.
    for (const b of e.trails.slice(-384)) {
      const a = previous.get(b.flightId);
      previous.set(b.flightId, b);
      // Arrival order may differ from emission order. Never connect distant samples.
      if (!a || Math.abs(a.emissionId - b.emissionId) !== 1) continue;
      const fade = Math.pow(
        Math.max(
          0,
          1 - (e.nowMs - b.arrivalAtMs) / (e.recipe.trailPersistenceSec * 1000),
        ),
        1.6,
      );
      position.setXYZ(count, a.position.x, a.position.y, a.position.z);
      position.setXYZ(count + 1, b.position.x, b.position.y, b.position.z);
      color.setXYZW(count, 0.72, 0.95, 1, fade);
      color.setXYZW(count + 1, 0.72, 0.95, 1, fade);
      count += 2;
      if (
        soundBody.current &&
        e.soundTraceMode === "soft" &&
        !reduced &&
        bodyCount < 384
      ) {
        const shape = soundPresence(
          e.nowMs - b.arrivalAtMs,
          e.recipe.trailPersistenceSec * 1000,
          e.designFor(b.flightId).sound?.body ?? 1,
        );
        temp.segment.set(
          b.position.x - a.position.x,
          b.position.y - a.position.y,
          b.position.z - a.position.z,
        );
        const length = temp.segment.length();
        if (length > 0.01 && length < 120 && shape.opacity > 0.001) {
          temp.dummy.position.set(
            (a.position.x + b.position.x) / 2,
            (a.position.y + b.position.y) / 2,
            (a.position.z + b.position.z) / 2,
          );
          temp.dummy.quaternion.setFromUnitVectors(
            UP,
            temp.segment.normalize(),
          );
          temp.dummy.scale.set(shape.radius, length, shape.radius);
          temp.dummy.updateMatrix();
          soundBody.current.setMatrixAt(bodyCount, temp.dummy.matrix);
          bodyFade.setX(bodyCount++, shape.opacity);
        }
      }
    }
    trailGeometry.setDrawRange(0, count);
    position.needsUpdate = true;
    color.needsUpdate = true;
    trailObject.frustumCulled = false;
    trailObject.visible = e.soundTraceMode !== "off";
    if (soundBody.current) {
      soundBody.current.count = bodyCount;
      soundBody.current.instanceMatrix.needsUpdate = true;
      bodyFade.needsUpdate = true;
    }
    trailMaterial.opacity = e.recipe.trailOpacity * (reduced ? 0.2 : 0.65);
    if (rings.current) {
      const recent = e.trails
        .filter((p) => p.emissionId % 8 === 0 && e.nowMs - p.arrivalAtMs < 1800)
        .slice(-8);
      rings.current.count =
        reduced || e.soundTraceMode !== "line" ? 0 : recent.length;
      const ringFade = ringGeometry.getAttribute("trailFade");
      recent.forEach((p, i) => {
        const age = (e.nowMs - p.arrivalAtMs) / 1800;
        temp.dummy.position.set(p.position.x, p.position.y, p.position.z);
        temp.dummy.quaternion.copy(camera.quaternion);
        temp.dummy.scale.setScalar(10 + age * 28);
        temp.dummy.updateMatrix();
        rings.current!.setMatrixAt(i, temp.dummy.matrix);
        ringFade.setX(i, Math.pow(Math.max(0, 1 - age), 1.6));
      });
      rings.current.instanceMatrix.needsUpdate = true;
      ringFade.needsUpdate = true;
    }
    window.__soundTrailRender = {
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      appearance: "procedural-v2",
      soundTrace: {
        mode: e.soundTraceMode,
        segments: bodyCount,
        lineSegments: e.soundTraceMode === "off" ? 0 : count / 2,
      },
      environment: scene.environment !== null,
    };
  });
  return (
    <>
      <SkyEnvironment visible={!passthrough} skyOnly={preview === "sky"} />
      {creationDesign && (
        <CreationModel
          design={creationDesign}
          vr={vr}
          placement={`${xr.status}/${xr.displayMode}/${!!preview}`}
          desktop={!!preview}
          offset={size.width < 760 ? 0 : previewOffset}
        />
      )}
      {!passthrough && <fog attach="fog" args={["#bfd2df", 3000, 18000]} />}
      <group visible={!passthrough && preview !== "sky"}>
        <Landscape airfield={airfield} />
        <EnvironmentWorld recipe={environment}/>
        {airfield && <Airfield />}
      </group>
      {preview === "hangar" && <PreviewHangar />}
      {preview === "airport" && <PreviewAirport />}
      {venue && !preview && xr.showVenue && xr.venueView === "overview" && (
        <VenueOverview
          venue={venue}
          vr={vr}
          placement={`${xr.status}/${xr.calibration}/${xr.overviewPlacement}`}
        />
      )}
      <group visible={vr.worldVisible && !preview}>
        {venue && (
          <VenueWorld
            venue={venue}
            markers={xr.showCalibration}
            map={xr.showVenue && xr.venueView === "space"}
          />
        )}
        {AIRCRAFT.map((a, index) => (
          <group
            key={a.id}
            ref={(mesh) => {
              aircraft.current[index] = mesh;
            }}
          >
            <Aircraft accent={a.accent} design={e.designFor(a.id)} />
          </group>
        ))}
      </group>
      <group visible={!passthrough && vr.worldVisible && !preview}>
        <primitive object={lineObject} ref={design} />
        <primitive object={trailObject} ref={trail} />
        <instancedMesh
          ref={soundBody}
          args={[bodyGeometry, bodyMaterial, 384]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={rings}
          args={[undefined, undefined, 8]}
          frustumCulled={false}
          material={ringMaterial}
          geometry={ringGeometry}
        />
      </group>
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
        if (props.vr.active || props.desktopPreview) return;
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
        if (props.desktopPreview) return;
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
            props.venue || props.view.current.free ? -1.3 : -0.12,
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
          else props.onClear();
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
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        }}
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
