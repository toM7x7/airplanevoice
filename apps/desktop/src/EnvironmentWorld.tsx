import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  environmentObjects,
  type EnvironmentRecipe,
  type EnvironmentObject,
} from "../../../packages/core/src/environment";

function Instances({
  objects,
  tree = false,
}: {
  objects: EnvironmentObject[];
  tree?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null),
    roof = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D(),
      color = new THREE.Color();
    for (const [i, o] of objects.entries()) {
      dummy.position.set(o.x, o.height / 2, o.z);
      dummy.scale.set(o.width, o.height, o.depth);
      dummy.updateMatrix();
      ref.current!.setMatrixAt(i, dummy.matrix);
      color.setHSL(
        tree ? 0.29 : 0.55,
        tree ? 0.18 : 0.09,
        tree ? 0.3 + o.tone * 0.12 : 0.46 + o.tone * 0.2,
      );
      ref.current!.setColorAt(i, color);
      dummy.position.y = o.height + 0.5;
      dummy.scale.y = 1;
      dummy.scale.x *= 1.04;
      dummy.scale.z *= 1.04;
      dummy.updateMatrix();
      roof.current?.setMatrixAt(i, dummy.matrix);
    }
    for (const mesh of [ref.current, roof.current])
      if (mesh) {
        mesh.count = objects.length;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
  }, [objects, tree]);
  return (
    <>
      <instancedMesh ref={ref} args={[undefined, undefined, 121]}>
        {tree ? (
          <coneGeometry args={[0.6, 1, 7]} />
        ) : (
          <boxGeometry args={[1, 1, 1]} />
        )}
        <meshStandardMaterial roughness={tree ? 0.95 : 0.7} />
      </instancedMesh>
      {!tree && (
        <instancedMesh ref={roof} args={[undefined, undefined, 121]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#6b7980" roughness={0.85} />
        </instancedMesh>
      )}
    </>
  );
}
export function EnvironmentWorld({ recipe }: { recipe: EnvironmentRecipe }) {
  const objects = useMemo(() => environmentObjects(recipe), [recipe]);
  return (
    <group name="procedural-environment">
      {recipe.preset !== "airfield" && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
          <planeGeometry args={[recipe.streetWidthM, 850]} />
          <meshStandardMaterial
            color={recipe.preset === "park" ? "#a5a28b" : "#6d7677"}
            roughness={1}
          />
        </mesh>
      )}
      {recipe.preset === "coast" && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[1900, 0.025, 200]}>
          <planeGeometry args={[3500, 3500]} />
          <meshStandardMaterial color="#7ab9c7" roughness={0.4} />
        </mesh>
      )}
      <Instances objects={objects.buildings} />
      <Instances objects={objects.trees} tree />
    </group>
  );
}
