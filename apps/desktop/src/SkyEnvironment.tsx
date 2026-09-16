import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// One source for the visible sun, directional light and reflected sky.
export const SUN_DIRECTION = new THREE.Vector3(-0.7, 0.7, -1).normalize();
const SUN_POSITION = SUN_DIRECTION.clone().multiplyScalar(5000).toArray();

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { sunDirection: { value: SUN_DIRECTION } },
    vertexShader: `varying vec3 skyDirection;
      void main() {
        skyDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying vec3 skyDirection;
      uniform vec3 sunDirection;
      void main() {
        vec3 d = normalize(skyDirection);
        float elevation = max(d.y, 0.0);
        vec3 horizon = vec3(0.64, 0.76, 0.84);
        vec3 zenith = vec3(0.095, 0.27, 0.50);
        vec3 sky = mix(horizon, zenith, pow(elevation, 0.42));
        float facingSun = max(dot(d, sunDirection), 0.0);
        sky += vec3(0.24, 0.18, 0.10) * pow(facingSun, 10.0);
        // Broad, stationary high cloud veils: no textures, no per-frame generation.
        vec2 p = d.xz / max(d.y + 0.22, 0.12);
        float wisps = sin(p.x * 2.1 + sin(p.y * 1.7)) * sin(p.y * 3.0 - p.x * 0.8);
        float veil = smoothstep(0.28, 0.90, wisps) * smoothstep(0.03, 0.28, elevation);
        sky = mix(sky, vec3(0.78, 0.84, 0.88), veil * 0.19);
        float disc = smoothstep(0.999975, 0.999994, facingSun);
        sky += vec3(5.0, 4.1, 2.9) * disc;
        // The same ground hemisphere provides soft reflected fill to the belly.
        vec3 ground = mix(vec3(0.14, 0.18, 0.15), horizon, exp(min(d.y, 0.0) * 16.0));
        vec3 radiance = mix(ground, sky, smoothstep(-0.02, 0.01, d.y));
        gl_FragColor = vec4(radiance, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** A static, locally generated environment. Shared flight state is untouched. */
export function SkyEnvironment({ visible = true }: { visible?: boolean }) {
  const { gl, scene } = useThree();
  const sky = useRef<THREE.Mesh>(null);
  const material = useMemo(skyMaterial, []);
  useFrame(({ camera }) => {
    // Keep the sun at infinity when the observer changes location, including XR.
    if (sky.current) camera.getWorldPosition(sky.current.position);
  });
  useLayoutEffect(() => {
    const source = new THREE.Scene();
    const geometry = new THREE.SphereGeometry(50, 24, 16);
    source.add(new THREE.Mesh(geometry, material));
    const generator = new THREE.PMREMGenerator(gl);
    const previous = scene.environment;
    const previousIntensity = scene.environmentIntensity;
    let environment: THREE.WebGLRenderTarget;
    try {
      // Captured once, before XR entry. Filtering gives stable broad highlights.
      environment = generator.fromScene(source, 0.025, 0.1, 100, { size: 128 });
    } finally {
      generator.dispose();
      geometry.dispose();
    }
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.8;
    return () => {
      scene.environment = previous;
      scene.environmentIntensity = previousIntensity;
      environment.dispose();
    };
  }, [gl, scene, material]);
  useLayoutEffect(() => () => material.dispose(), [material]);
  return (
    <>
      <mesh
        ref={sky}
        material={material}
        frustumCulled={false}
        visible={visible}
      >
        <sphereGeometry args={[18000, 24, 16]} />
      </mesh>
      <hemisphereLight args={["#e5f0ff", "#8a937d", 0.45]} />
      <directionalLight
        position={SUN_POSITION}
        intensity={2.8}
        color="#fff0d8"
      />
    </>
  );
}
