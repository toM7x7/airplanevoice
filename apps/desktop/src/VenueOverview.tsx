import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { VenueMap } from "../../../packages/core/src/venue";
import type { VrRuntime } from "./vr";
import { venueOverviewLayout } from "./venue-overview";

/** A locally placed map card. Its transform never reaches the simulation or ears. */
export function VenueOverview({
  venue,
  vr,
  placement,
}: {
  venue: VenueMap;
  vr: VrRuntime;
  placement: string;
}) {
  const root = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const pending = useRef(2);
  const temp = useMemo(
    () => ({
      position: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      rotation: new THREE.Quaternion(),
    }),
    [],
  );
  useEffect(() => {
    pending.current = 2;
  }, [placement]);
  const layout = useMemo(() => venueOverviewLayout(venue), [venue]);
  const immersive = vr.active;
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 768;
    const c = canvas.getContext("2d")!;
    const text = (
      value: string,
      x: number,
      y: number,
      size: number,
      color = "#f6fff9",
      max = 940,
    ) => {
      c.fillStyle = color;
      c.font = `${size}px sans-serif`;
      c.fillText(value, x, y, max);
    };
    c.fillStyle = "#102e35";
    c.fillRect(0, 0, 1024, 768);
    text("会場の配置図", 40, 56, 36);
    text(
      `縮尺 約1:${Math.round(1 / layout.scale)} ／ 右 +X・上 −Z`,
      40,
      98,
      25,
      "#a9d6d2",
    );
    c.strokeStyle = "#45646a";
    c.lineWidth = 1;
    c.strokeRect(42, 122, 940, 420);
    c.setLineDash([4, 8]);
    c.beginPath();
    c.moveTo(42, layout.origin.y);
    c.lineTo(982, layout.origin.y);
    c.moveTo(layout.origin.x, 122);
    c.lineTo(layout.origin.x, 542);
    c.stroke();
    c.setLineDash([]);
    text("A", layout.origin.x + 12, layout.origin.y + 8, 24);
    c.fillStyle = "#fff";
    c.fillRect(layout.origin.x - 4, layout.origin.y - 4, 8, 8);
    // Small numbered pins keep long booth names out of the map itself.
    for (const [i, p] of layout.points.entries()) {
      const selected = p.id === venue.selectedId,
        { x, y } = p.drawing;
      c.fillStyle = selected ? "#ffcf76" : "#b1e5df";
      c.beginPath();
      c.arc(x, y, selected ? 24 : 20, 0, Math.PI * 2);
      c.fill();
      c.textAlign = "center";
      text(`${i + 1}`, x, y + 9, 27, "#12353a");
      c.textAlign = "left";
      text(
        `${selected ? "●" : "○"} ${i + 1} ${p.name}`,
        40 + (i % 2) * 485,
        593 + Math.floor(i / 2) * 42,
        25,
        selected ? "#ffcf76" : "#edf8f4",
        455,
      );
    }
    text(
      immersive
        ? "地点選びは操作盤から ／ グリップで操作盤を呼ぶ"
        : "左の地点ボタンで選択 ／ ドラッグで見回す",
      40,
      697,
      25,
      "#a9d6d2",
    );
    text(
      "図面画像は未登録。音は今いる場所で聴こえます。",
      40,
      739,
      25,
      "#a9d6d2",
    );
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [layout, venue.selectedId, immersive]);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame(() => {
    const g = root.current;
    if (!g) return;
    if (pending.current > 0) {
      g.visible = false;
      if (--pending.current > 0) return;
      camera.getWorldPosition(temp.position);
      camera.getWorldQuaternion(temp.rotation);
      temp.forward.set(0, 0, -1).applyQuaternion(temp.rotation);
      g.position.copy(temp.position).addScaledVector(temp.forward, 1.65);
      g.quaternion.copy(temp.rotation);
      g.updateMatrixWorld(true);
    }
    // Avoid covering the operation panel. The card stays at its placement when looking away.
    g.visible = !vr.active || !vr.panelVisible;
  });
  return (
    <group ref={root} visible={false} name="venue-overview">
      <mesh>
        <planeGeometry args={[1.2, 0.9]} />
        <meshBasicMaterial
          map={texture}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      {layout.points.map((p) => (
        <mesh
          key={p.id}
          position={[
            (p.drawing.x / 1024 - 0.5) * 1.2,
            (0.5 - p.drawing.y / 768) * 0.9,
            0.016,
          ]}
        >
          <torusGeometry
            args={[p.id === venue.selectedId ? 0.032 : 0.026, 0.003, 5, 20]}
          />
          <meshBasicMaterial
            color={p.id === venue.selectedId ? "#ffcf76" : "#b1e5df"}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
