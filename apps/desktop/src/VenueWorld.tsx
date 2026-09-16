import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { VenueMap } from "../../../packages/core/src/venue";

function Label({
  text,
  position,
}: {
  text: string;
  position: [number, number, number];
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 80;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#12353a";
    ctx.fillRect(0, 0, 512, 80);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, 256, 52, 490);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite position={position} scale={[0.75, 0.12, 1]}>
      <spriteMaterial map={texture} depthTest={false} />
    </sprite>
  );
}
export function VenueWorld({
  venue,
  markers,
  map,
}: {
  venue: VenueMap;
  markers: boolean;
  map: boolean;
}) {
  const h = venue.tableHeightM,
    d = venue.baselineM;
  return (
    <group>
      {markers && (
        <group>
          <mesh position={[d / 2, h, -d / 2]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[d, d]} />
            <meshBasicMaterial
              color="#d8eee5"
              wireframe
              side={THREE.DoubleSide}
            />
          </mesh>
          {(
            [
              [0, h, 0],
              [d, h, 0],
              [0, h, -d],
            ] as [number, number, number][]
          ).map((p, i) => (
            <group key={i}>
              <mesh position={p}>
                <sphereGeometry args={[0.025, 16, 10]} />
                <meshBasicMaterial color={i === 2 ? "#ffffff" : "#ffda80"} />
              </mesh>
              <Label
                text={`${"ABC"[i]}${i === 2 ? " 確認点" : " 基準点"}`}
                position={[p[0], p[1] + 0.13, p[2]]}
              />
            </group>
          ))}
        </group>
      )}
      {map &&
        venue.points.map((p) => (
          <group key={p.id} position={[p.x, h, p.z]}>
            <mesh>
              <cylinderGeometry args={[0.04, 0.04, 0.15, 10]} />
              <meshBasicMaterial
                color={p.id === venue.selectedId ? "#ffcc66" : "#9bd6cf"}
              />
            </mesh>
            <Label
              text={`${p.id === venue.selectedId ? "● " : ""}${p.name}`}
              position={[0, 0.2, 0]}
            />
          </group>
        ))}
    </group>
  );
}
