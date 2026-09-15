import * as THREE from "three";

/** A soft opening around each visible aircraft, evaluated separately for each XR eye. */
export class TrailVisibility {
  readonly aircraft = {
    value: Array.from({ length: 3 }, () => new THREE.Vector4()),
  };

  apply<T extends THREE.Material>(material: T, instanceFade = false): T {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.trailAircraft = this.aircraft;
      shader.vertexShader = `varying vec3 vTrailViewPosition;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvTrailViewPosition = mvPosition.xyz;",
      );
      if (instanceFade) {
        shader.vertexShader = `attribute float trailFade; varying float vTrailFade;\n${shader.vertexShader}`;
        shader.vertexShader = shader.vertexShader.replace(
          "vTrailViewPosition = mvPosition.xyz;",
          "vTrailViewPosition = mvPosition.xyz; vTrailFade = trailFade;",
        );
        shader.fragmentShader = `varying float vTrailFade;\n${shader.fragmentShader}`;
      }
      shader.fragmentShader = `
        varying vec3 vTrailViewPosition;
        uniform vec4 trailAircraft[3];
        ${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `
        vec3 trailRay = normalize(vTrailViewPosition);
        float clearance = 1.0;
        for (int i = 0; i < 3; i++) {
          vec4 aircraft = trailAircraft[i];
          if (aircraft.w <= 0.0) continue;
          vec3 centre = (viewMatrix * vec4(aircraft.xyz, 1.0)).xyz;
          float along = dot(centre, trailRay);
          if (centre.z >= 0.0 || along <= 0.0) continue;
          float separation = length(centre - trailRay * along);
          // Keep at least 0.8 degrees of apparent clearance, even around a distant aircraft.
          float radius = max(aircraft.w, length(centre) * 0.01396354);
          clearance = min(clearance, smoothstep(radius, radius * 1.8, separation));
        }
        diffuseColor.a *= clearance ${instanceFade ? "* vTrailFade" : ""};
        #include <opaque_fragment>
        `,
      );
    };
    material.customProgramCacheKey = () =>
      `sound-trail-aircraft-clearance-v2-${instanceFade}`;
    return material;
  }
}
